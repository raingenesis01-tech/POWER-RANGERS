import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const schemaPath = path.join(root, 'database', 'schema.sql');
const seedPath = path.join(root, 'database', 'seed.json');

fs.mkdirSync(dataDir, { recursive: true });

function seed(driver) {
  if (driver.listClassrooms().length > 0) {
    return;
  }
  const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const ids = new Map();
  for (const room of seedData.classrooms) {
    const created = driver.insertClassroom({
      room_number: room.room_number,
      building: room.building,
      floor: room.floor,
      blynk_token: null,
      presence_pin: 'V0',
      heartbeat_pin: 'V1',
      demo_mode: room.demo_mode ? 1 : 0,
      simulated_presence: room.simulated_presence ? 1 : 0,
    });
    ids.set(`${room.building}::${room.room_number}`, created.id);
  }
  for (const pattern of seedData.patterns) {
    const classroomId = ids.get(`${pattern.building}::${pattern.room_number}`);
    for (const day of pattern.days) {
      for (const block of pattern.blocks) {
        driver.insertSchedule({
          classroom_id: classroomId,
          day_of_week: day,
          start_time: block.start_time,
          end_time: block.end_time,
          subject: block.subject,
          section: block.section,
          instructor: block.instructor,
        });
      }
    }
  }
}

function sortRooms(rooms) {
  return [...rooms].sort(
    (a, b) => a.building.localeCompare(b.building)
      || a.floor - b.floor
      || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
  );
}

function sortSchedules(schedules) {
  return [...schedules].sort(
    (a, b) => a.classroom_id - b.classroom_id
      || a.day_of_week - b.day_of_week
      || a.start_time.localeCompare(b.start_time),
  );
}

function createSqlite(DatabaseSync) {
  const database = new DatabaseSync(path.join(dataDir, 'classroom.db'));
  database.exec(fs.readFileSync(schemaPath, 'utf8'));
  const insertClassroom = database.prepare(`
    INSERT INTO classrooms (
      room_number, building, floor, blynk_token, presence_pin, heartbeat_pin, demo_mode, simulated_presence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSchedule = database.prepare(`
    INSERT INTO schedules (
      classroom_id, day_of_week, start_time, end_time, subject, section, instructor
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const driver = {
    kind: 'sqlite',
    listClassrooms() {
      return sortRooms(database.prepare('SELECT * FROM classrooms').all());
    },
    getClassroom(id) {
      return database.prepare('SELECT * FROM classrooms WHERE id = ?').get(id) || null;
    },
    insertClassroom(row) {
      const info = insertClassroom.run(
        row.room_number,
        row.building,
        row.floor,
        row.blynk_token,
        row.presence_pin,
        row.heartbeat_pin,
        row.demo_mode,
        row.simulated_presence,
      );
      return driver.getClassroom(Number(info.lastInsertRowid));
    },
    updateClassroom(id, row) {
      const info = database.prepare(`
        UPDATE classrooms SET room_number = ?, building = ?, floor = ? WHERE id = ?
      `).run(row.room_number, row.building, row.floor, id);
      return info.changes ? driver.getClassroom(id) : null;
    },
    updateDevice(id, row) {
      const current = driver.getClassroom(id);
      if (!current) {
        return null;
      }
      let token = current.blynk_token;
      if (row.tokenAction === 'clear') {
        token = null;
      } else if (row.tokenAction === 'set') {
        token = row.blynk_token;
      }
      database.prepare(`
        UPDATE classrooms
        SET blynk_token = ?, presence_pin = ?, heartbeat_pin = ?, demo_mode = ?, simulated_presence = ?
        WHERE id = ?
      `).run(token, row.presence_pin, row.heartbeat_pin, row.demo_mode, row.simulated_presence, id);
      return driver.getClassroom(id);
    },
    deleteClassroom(id) {
      const info = database.prepare('DELETE FROM classrooms WHERE id = ?').run(id);
      return info.changes > 0;
    },
    listSchedules() {
      return sortSchedules(database.prepare('SELECT * FROM schedules').all());
    },
    insertSchedule(row) {
      const info = insertSchedule.run(
        row.classroom_id,
        row.day_of_week,
        row.start_time,
        row.end_time,
        row.subject,
        row.section,
        row.instructor,
      );
      return database.prepare('SELECT * FROM schedules WHERE id = ?').get(Number(info.lastInsertRowid));
    },
    updateSchedule(id, row) {
      const info = database.prepare(`
        UPDATE schedules
        SET classroom_id = ?, day_of_week = ?, start_time = ?, end_time = ?, subject = ?, section = ?, instructor = ?
        WHERE id = ?
      `).run(
        row.classroom_id,
        row.day_of_week,
        row.start_time,
        row.end_time,
        row.subject,
        row.section,
        row.instructor,
        id,
      );
      return info.changes
        ? database.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
        : null;
    },
    deleteSchedule(id) {
      const info = database.prepare('DELETE FROM schedules WHERE id = ?').run(id);
      return info.changes > 0;
    },
  };
  database.exec('BEGIN');
  try {
    seed(driver);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return driver;
}

function createJson() {
  const filePath = path.join(dataDir, 'classroom.json');
  const state = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
    : { classrooms: [], schedules: [], sequence: { classroom: 1, schedule: 1 } };

  function save() {
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
    fs.renameSync(temporary, filePath);
  }

  const driver = {
    kind: 'json',
    listClassrooms() {
      return sortRooms(state.classrooms);
    },
    getClassroom(id) {
      return state.classrooms.find((room) => room.id === id) || null;
    },
    insertClassroom(row) {
      const created = { id: state.sequence.classroom, ...row };
      state.sequence.classroom += 1;
      state.classrooms.push(created);
      save();
      return created;
    },
    updateClassroom(id, row) {
      const current = driver.getClassroom(id);
      if (!current) {
        return null;
      }
      current.room_number = row.room_number;
      current.building = row.building;
      current.floor = row.floor;
      save();
      return current;
    },
    updateDevice(id, row) {
      const current = driver.getClassroom(id);
      if (!current) {
        return null;
      }
      if (row.tokenAction === 'clear') {
        current.blynk_token = null;
      } else if (row.tokenAction === 'set') {
        current.blynk_token = row.blynk_token;
      }
      current.presence_pin = row.presence_pin;
      current.heartbeat_pin = row.heartbeat_pin;
      current.demo_mode = row.demo_mode;
      current.simulated_presence = row.simulated_presence;
      save();
      return current;
    },
    deleteClassroom(id) {
      const before = state.classrooms.length;
      state.classrooms = state.classrooms.filter((room) => room.id !== id);
      state.schedules = state.schedules.filter((item) => item.classroom_id !== id);
      if (state.classrooms.length === before) {
        return false;
      }
      save();
      return true;
    },
    listSchedules() {
      return sortSchedules(state.schedules);
    },
    insertSchedule(row) {
      const created = { id: state.sequence.schedule, ...row };
      state.sequence.schedule += 1;
      state.schedules.push(created);
      save();
      return created;
    },
    updateSchedule(id, row) {
      const current = state.schedules.find((item) => item.id === id);
      if (!current) {
        return null;
      }
      Object.assign(current, row);
      save();
      return current;
    },
    deleteSchedule(id) {
      const before = state.schedules.length;
      state.schedules = state.schedules.filter((item) => item.id !== id);
      if (state.schedules.length === before) {
        return false;
      }
      save();
      return true;
    },
  };
  seed(driver);
  return driver;
}

let driver;
try {
  const sqlite = await import('node:sqlite');
  driver = createSqlite(sqlite.DatabaseSync);
} catch (error) {
  console.warn(`Built-in SQLite is unavailable (${error.message}). Using the JSON database fallback.`);
  driver = createJson();
}

export const databaseKind = driver.kind;
export const listClassrooms = () => driver.listClassrooms();
export const getClassroom = (id) => driver.getClassroom(id);
export const insertClassroom = (row) => driver.insertClassroom(row);
export const updateClassroom = (id, row) => driver.updateClassroom(id, row);
export const updateDevice = (id, row) => driver.updateDevice(id, row);
export const deleteClassroom = (id) => driver.deleteClassroom(id);
export const listSchedules = () => driver.listSchedules();
export const insertSchedule = (row) => driver.insertSchedule(row);
export const updateSchedule = (id, row) => driver.updateSchedule(id, row);
export const deleteSchedule = (id) => driver.deleteSchedule(id);
