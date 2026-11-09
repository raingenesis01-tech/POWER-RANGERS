import { readDevice } from './blynk.js';
import { listClassrooms, listSchedules } from './db.js';
import { judgeHeartbeat } from './heartbeat.js';
import { buildSnapshot } from './snapshot.js';

const memory = new Map();
const logged = new Map();
let current = null;
let polling = false;

function remember(roomId, message) {
  if (logged.get(roomId) === message) {
    return;
  }
  logged.set(roomId, message);
  console.log(`Room ${roomId}: ${message}`);
}

async function sense(room, now) {
  if (room.demo_mode) {
    const present = room.simulated_presence === 1;
    remember(room.id, present ? 'simulated presence' : 'simulated empty');
    return {
      sensorOnline: true,
      presence: present,
      dataSource: 'simulated',
      lastUpdate: new Date(now).toISOString(),
      publicDetail: 'Simulated demonstration reading. This is not a live sensor.',
      adminDetail: 'Simulation is on. Turn it off after a real Blynk token is saved.',
    };
  }

  if (!room.blynk_token) {
    remember(room.id, 'no token');
    return {
      sensorOnline: false,
      presence: null,
      dataSource: 'none',
      lastUpdate: null,
      publicDetail: 'No device is assigned. This room is not marked available.',
      adminDetail: 'Save a Blynk device token, or turn on simulation for a labeled demonstration.',
    };
  }

  const reading = await readDevice({
    server: process.env.BLYNK_SERVER || 'https://blynk.cloud',
    token: room.blynk_token,
    presencePin: room.presence_pin,
    heartbeatPin: room.heartbeat_pin,
  });
  const judged = judgeHeartbeat(
    memory.get(room.id),
    reading,
    now,
    Number(process.env.STALE_MS || 45000),
  );
  memory.set(room.id, judged.memory);
  remember(room.id, judged.sensorOnline ? `live presence ${judged.presence ? 1 : 0}` : `offline: ${judged.reason}`);
  return {
    sensorOnline: judged.sensorOnline,
    presence: judged.presence,
    dataSource: 'blynk',
    lastUpdate: judged.lastUpdate,
    publicDetail: judged.sensorOnline
      ? 'Live reading from the classroom device through Blynk.'
      : 'Sensor offline. This room is not marked available.',
    adminDetail: judged.reason,
  };
}

export function getSnapshot() {
  return current;
}

export async function pollOnce(now = Date.now()) {
  const rooms = listClassrooms();
  const sensors = new Map();
  for (const room of rooms) {
    sensors.set(room.id, await sense(room, now));
  }
  current = buildSnapshot({
    rooms,
    schedules: listSchedules(),
    sensors,
    timeZone: process.env.SCHOOL_TIMEZONE || 'Asia/Manila',
    now: new Date(now),
  });
  return current;
}

export async function tick() {
  if (polling) {
    return current;
  }
  polling = true;
  try {
    return await pollOnce();
  } catch (error) {
    console.error('Polling failed:', error.message);
    return current;
  } finally {
    polling = false;
  }
}
