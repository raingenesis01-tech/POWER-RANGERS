import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { databaseKind, deleteClassroom, deleteSchedule, getClassroom, insertClassroom, insertSchedule, listClassrooms, listSchedules, updateClassroom, updateDevice, updateSchedule } from './db.js';
import { loadEnv } from './env.js';
import { rangesOverlap, timeToMinutes } from './classify.js';
import { getSnapshot, pollOnce, tick } from './poller.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = path.join(root, 'frontend');
const envPath = path.join(root, '.env');
const sessions = new Map();
const loginFailures = new Map();
let pollTimer = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function send(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'sc_session') {
      return rest.join('=');
    }
  }
  return '';
}

function isAdmin(req) {
  const token = readCookie(req);
  const expiry = sessions.get(token);
  if (!expiry) {
    return false;
  }
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req) {
  if (!process.env.ADMIN_PASSWORD) {
    throw httpError(503, 'Set ADMIN_PASSWORD in the .env file before using administrator tools.');
  }
  if (!isAdmin(req)) {
    throw httpError(401, 'Administrator sign-in is required.');
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100000) {
      throw httpError(413, 'The request is too large.');
    }
    chunks.push(chunk);
  }
  if (size === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'The request body is not valid JSON.');
  }
}

function cleanText(value, field, max) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw httpError(400, `${field} is required.`);
  }
  if (text.length > max) {
    throw httpError(400, `${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function cleanPin(value, fallback) {
  const pin = String(value || fallback).trim().toUpperCase();
  if (!/^V\d{1,3}$/.test(pin)) {
    throw httpError(400, 'Virtual pins must look like V0 or V1.');
  }
  return pin;
}

function roomFields(body, existingId = null) {
  const roomNumber = cleanText(body.roomNumber, 'Room number', 20);
  const building = cleanText(body.building, 'Building', 60);
  const floor = Number(body.floor);
  if (!Number.isInteger(floor) || floor < 0 || floor > 40) {
    throw httpError(400, 'Floor must be a whole number from 0 through 40.');
  }
  const duplicate = listClassrooms().some((room) => (
    room.id !== existingId
    && room.building.toLowerCase() === building.toLowerCase()
    && room.room_number.toLowerCase() === roomNumber.toLowerCase()
  ));
  if (duplicate) {
    throw httpError(409, 'That room already exists in this building.');
  }
  return { room_number: roomNumber, building, floor };
}

function scheduleFields(body, existingId = null) {
  const classroomId = Number(body.classroomId);
  if (!getClassroom(classroomId)) {
    throw httpError(400, 'Choose a classroom that exists.');
  }
  const dayOfWeek = Number(body.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw httpError(400, 'Choose a day of the week.');
  }
  const startTime = cleanText(body.startTime, 'Start time', 5);
  const endTime = cleanText(body.endTime, 'End time', 5);
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime, true);
  if (start === null || end === null || end <= start) {
    throw httpError(400, 'Use a valid start and end time, with the end after the start.');
  }
  const overlap = listSchedules().some((item) => (
    item.id !== existingId
    && item.classroom_id === classroomId
    && item.day_of_week === dayOfWeek
    && rangesOverlap(start, end, timeToMinutes(item.start_time), timeToMinutes(item.end_time, true))
  ));
  if (overlap) {
    throw httpError(409, 'That time overlaps another class in the same room.');
  }
  return {
    classroom_id: classroomId,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
    subject: cleanText(body.subject, 'Subject', 80),
    section: cleanText(body.section, 'Section', 80),
    instructor: cleanText(body.instructor, 'Instructor', 80),
  };
}

function forVisitor(room, includeWeek) {
  const copy = { ...room };
  delete copy.adminDetail;
  if (!includeWeek) {
    delete copy.week;
  }
  return copy;
}

function adminRoom(snapshotRoom, stored) {
  const schedules = (snapshotRoom?.week || []).map((item) => ({ ...item }));
  return {
    id: stored.id,
    roomNumber: stored.room_number,
    building: stored.building,
    floor: stored.floor,
    presencePin: stored.presence_pin,
    heartbeatPin: stored.heartbeat_pin,
    demoMode: stored.demo_mode === 1,
    simulatedPresence: stored.simulated_presence === 1,
    hasToken: Boolean(stored.blynk_token),
    status: snapshotRoom?.status || 'UNKNOWN',
    statusLabel: snapshotRoom?.statusLabel || 'Sensor offline',
    sensorOnline: Boolean(snapshotRoom?.sensorOnline),
    dataSource: snapshotRoom?.dataSource || 'none',
    lastUpdate: snapshotRoom?.lastUpdate || null,
    adminDetail: snapshotRoom?.adminDetail || null,
    schedules,
  };
}

function clientAddress(req) {
  return req.socket.remoteAddress || 'local';
}

function tooManyLogins(address) {
  const entry = loginFailures.get(address);
  if (!entry || Date.now() > entry.reset) {
    loginFailures.delete(address);
    return false;
  }
  return entry.count >= 8;
}

function recordLoginFailure(address) {
  const entry = loginFailures.get(address);
  if (!entry || Date.now() > entry.reset) {
    loginFailures.set(address, { count: 1, reset: Date.now() + 60000 });
    return;
  }
  entry.count += 1;
}

function passwordsMatch(input, expected) {
  const left = Buffer.from(String(input));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  if (!sameOrigin(req)) {
    throw httpError(403, 'The request origin is not allowed.');
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true, database: databaseKind, blynkServer: process.env.BLYNK_SERVER || 'https://blynk.cloud' });
  }
  if (req.method === 'GET' && pathname === '/api/overview') {
    const snapshot = getSnapshot();
    return send(res, 200, {
      ...snapshot,
      classrooms: snapshot.classrooms.map((room) => forVisitor(room, false)),
    });
  }
  const detailMatch = pathname.match(/^\/api\/classrooms\/(\d+)$/);
  if (req.method === 'GET' && detailMatch) {
    const room = getSnapshot().classrooms.find((item) => item.id === Number(detailMatch[1]));
    if (!room) {
      throw httpError(404, 'That classroom was not found.');
    }
    return send(res, 200, forVisitor(room, true));
  }
  if (req.method === 'GET' && pathname === '/api/admin/session') {
    return send(res, 200, {
      authenticated: isAdmin(req),
      adminEnabled: Boolean(process.env.ADMIN_PASSWORD),
    });
  }
  if (req.method === 'POST' && pathname === '/api/admin/login') {
    if (!process.env.ADMIN_PASSWORD) {
      throw httpError(503, 'Set ADMIN_PASSWORD in the .env file before signing in.');
    }
    const address = clientAddress(req);
    if (tooManyLogins(address)) {
      throw httpError(429, 'Too many sign-in attempts. Wait a minute and try again.');
    }
    const body = await readJson(req);
    if (!passwordsMatch(body.password || '', process.env.ADMIN_PASSWORD)) {
      recordLoginFailure(address);
      throw httpError(401, 'The password is not correct.');
    }
    loginFailures.delete(address);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
    return send(res, 200, { authenticated: true }, {
      'Set-Cookie': `sc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
    });
  }
  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    sessions.delete(readCookie(req));
    return send(res, 200, { authenticated: false }, {
      'Set-Cookie': 'sc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    });
  }

  if (pathname.startsWith('/api/admin/')) {
    requireAdmin(req);
  }

  if (req.method === 'GET' && pathname === '/api/admin/classrooms') {
    const snapshot = getSnapshot();
    const rooms = listClassrooms().map((stored) => adminRoom(
      snapshot.classrooms.find((item) => item.id === stored.id),
      stored,
    ));
    return send(res, 200, { timezone: snapshot.timezone, schoolClock: snapshot.schoolClock, classrooms: rooms });
  }

  if (req.method === 'POST' && pathname === '/api/admin/classrooms') {
    const body = await readJson(req);
    const fields = roomFields(body);
    insertClassroom({
      ...fields,
      blynk_token: null,
      presence_pin: 'V0',
      heartbeat_pin: 'V1',
      demo_mode: body.demoMode ? 1 : 0,
      simulated_presence: body.simulatedPresence ? 1 : 0,
    });
    await pollOnce();
    return send(res, 201, { ok: true });
  }

  const roomMatch = pathname.match(/^\/api\/admin\/classrooms\/(\d+)$/);
  if (roomMatch && req.method === 'PUT') {
    const id = Number(roomMatch[1]);
    if (!getClassroom(id)) {
      throw httpError(404, 'That classroom was not found.');
    }
    updateClassroom(id, roomFields(await readJson(req), id));
    await pollOnce();
    return send(res, 200, { ok: true });
  }
  if (roomMatch && req.method === 'DELETE') {
    const id = Number(roomMatch[1]);
    if (!deleteClassroom(id)) {
      throw httpError(404, 'That classroom was not found.');
    }
    await pollOnce();
    return send(res, 200, { ok: true });
  }

  const deviceMatch = pathname.match(/^\/api\/admin\/classrooms\/(\d+)\/device$/);
  if (deviceMatch && req.method === 'PUT') {
    const id = Number(deviceMatch[1]);
    if (!getClassroom(id)) {
      throw httpError(404, 'That classroom was not found.');
    }
    const body = await readJson(req);
    let tokenAction = 'keep';
    let token = null;
    if (body.clearToken) {
      tokenAction = 'clear';
    } else if (String(body.blynkToken || '').trim()) {
      tokenAction = 'set';
      token = String(body.blynkToken).trim();
      if (token.length < 8 || token.length > 80) {
        throw httpError(400, 'The Blynk token does not look valid.');
      }
    }
    updateDevice(id, {
      tokenAction,
      blynk_token: token,
      presence_pin: cleanPin(body.presencePin, 'V0'),
      heartbeat_pin: cleanPin(body.heartbeatPin, 'V1'),
      demo_mode: body.demoMode ? 1 : 0,
      simulated_presence: body.simulatedPresence ? 1 : 0,
    });
    await pollOnce();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/admin/schedules') {
    insertSchedule(scheduleFields(await readJson(req)));
    await pollOnce();
    return send(res, 201, { ok: true });
  }
  const scheduleMatch = pathname.match(/^\/api\/admin\/schedules\/(\d+)$/);
  if (scheduleMatch && req.method === 'PUT') {
    const id = Number(scheduleMatch[1]);
    const existing = listSchedules().find((item) => item.id === id);
    if (!existing) {
      throw httpError(404, 'That class was not found.');
    }
    updateSchedule(id, scheduleFields(await readJson(req), id));
    await pollOnce();
    return send(res, 200, { ok: true });
  }
  if (scheduleMatch && req.method === 'DELETE') {
    const id = Number(scheduleMatch[1]);
    if (!deleteSchedule(id)) {
      throw httpError(404, 'That class was not found.');
    }
    await pollOnce();
    return send(res, 200, { ok: true });
  }

  throw httpError(404, 'That API path was not found.');
}

function serveFile(res, requestPath) {
  const relative = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath).replace(/^\/+/, '');
  const full = path.normalize(path.join(frontendRoot, relative));
  const rootWithSep = frontendRoot.endsWith(path.sep) ? frontendRoot : frontendRoot + path.sep;
  if (full !== frontendRoot && !full.startsWith(rootWithSep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const extension = path.extname(full).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
  });
  fs.createReadStream(full).pipe(res);
}

async function onRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }
    serveFile(res, url.pathname);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) {
      console.error(error);
    }
    if (!res.headersSent) {
      send(res, status, { error: status === 500 ? 'The server hit an unexpected problem.' : error.message });
    }
  }
}

export async function start(port) {
  loadEnv(envPath);
  const listenPort = Number(port ?? process.env.PORT ?? 3000);
  await pollOnce();
  const server = http.createServer(onRequest);
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  await new Promise((resolve) => server.listen(listenPort, '0.0.0.0', resolve));
  const interval = Number(process.env.POLL_INTERVAL_MS || 10000);
  pollTimer = setInterval(() => {
    tick().catch((error) => console.error(error));
  }, interval);
  return {
    server,
    port: server.address().port,
    stop() {
      clearInterval(pollTimer);
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  start().then(({ port }) => {
    console.log(`Smart Classroom website: http://localhost:${port}`);
    console.log(`Database: ${databaseKind}`);
    console.log(process.env.ADMIN_PASSWORD
      ? 'Administrator sign-in is enabled.'
      : 'Administrator sign-in is disabled until ADMIN_PASSWORD is set in .env.');
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
