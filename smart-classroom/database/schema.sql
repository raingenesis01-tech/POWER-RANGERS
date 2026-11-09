-- Local database for the hackathon prototype.
-- The Node server creates these tables with the built-in SQLite module.
-- Device tokens live in classrooms.blynk_token. That file is created under data/ and is not committed.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS classrooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_number TEXT NOT NULL,
  building TEXT NOT NULL,
  floor INTEGER NOT NULL,
  blynk_token TEXT,
  presence_pin TEXT NOT NULL DEFAULT 'V0',
  heartbeat_pin TEXT NOT NULL DEFAULT 'V1',
  demo_mode INTEGER NOT NULL DEFAULT 0,
  simulated_presence INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classroom_id INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  subject TEXT NOT NULL,
  section TEXT NOT NULL,
  instructor TEXT NOT NULL,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_classrooms_building_room
  ON classrooms (building, room_number);

CREATE INDEX IF NOT EXISTS idx_schedules_classroom
  ON schedules (classroom_id, day_of_week, start_time);
