import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classify } from './classify.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-classroom-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test-password';
process.env.POLL_INTERVAL_MS = '600000';
process.env.SCHOOL_TIMEZONE = 'Asia/Manila';

const { start } = await import('./server.js');

test('the website classifies seeded rooms and keeps Blynk tokens on the server', async (t) => {
  const app = await start(0);
  t.after(() => app.stop());
  const origin = `http://127.0.0.1:${app.port}`;

  const overviewResponse = await fetch(`${origin}/api/overview`);
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.classrooms.length, 6);

  const totals = overview.totals;
  assert.equal(
    totals.inClass + totals.occupied + totals.available + totals.scheduledEmpty + totals.unknown,
    totals.classrooms,
  );
  assert.equal(totals.devicesOnline + totals.devicesOffline, totals.classrooms);

  const byNumber = Object.fromEntries(overview.classrooms.map((room) => [room.roomNumber, room]));
  assert.equal(byNumber.D1.status, 'IN_CLASS');
  assert.equal(byNumber.D1.dataSource, 'simulated');
  assert.equal(byNumber.D2.status, 'SCHEDULED_EMPTY');
  assert.equal(byNumber.D2.dataSource, 'simulated');
  assert.equal(byNumber['202'].status, 'UNKNOWN');
  assert.equal(byNumber['202'].dataSource, 'none');
  assert.equal(JSON.stringify(overview).includes('blynk_token'), false);
  assert.equal(JSON.stringify(overview).includes('adminDetail'), false);

  for (const number of ['101', '102']) {
    const room = byNumber[number];
    const expected = classify({
      sensorOnline: true,
      presence: room.presence,
      scheduled: room.scheduleToday.some((item) => item.isCurrent),
    });
    assert.equal(room.status, expected);
    assert.equal(room.dataSource, 'simulated');
  }

  const detail = await fetch(`${origin}/api/classrooms/${byNumber.D1.id}`);
  const detailBody = await detail.json();
  assert.ok(detailBody.week.length >= 7);
  assert.equal(Object.hasOwn(detailBody, 'adminDetail'), false);

  const blocked = await fetch(`${origin}/api/admin/classrooms`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomNumber: '9', building: 'Main', floor: 1 }),
  });
  assert.equal(blocked.status, 403);

  const login = await fetch(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const secret = 'super-secret-blynk-token';
  const created = await fetch(`${origin}/api/admin/classrooms`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ roomNumber: '301', building: 'Main', floor: 3, demoMode: true, simulatedPresence: false }),
  });
  assert.equal(created.status, 201);

  const adminList = await fetch(`${origin}/api/admin/classrooms`, {
    headers: { Cookie: cookie },
  });
  const adminBody = await adminList.json();
  const createdRoom = adminBody.classrooms.find((room) => room.roomNumber === '301');
  const saved = await fetch(`${origin}/api/admin/classrooms/${createdRoom.id}/device`, {
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      blynkToken: secret,
      demoMode: true,
      simulatedPresence: false,
      presencePin: 'V0',
      heartbeatPin: 'V1',
    }),
  });
  assert.equal(saved.status, 200);

  const after = await fetch(`${origin}/api/overview`);
  const afterBody = await after.json();
  const listedAgain = await fetch(`${origin}/api/admin/classrooms`, { headers: { Cookie: cookie } });
  const listedBody = await listedAgain.json();
  const savedRoom = listedBody.classrooms.find((room) => room.roomNumber === '301');
  assert.equal(savedRoom.hasToken, true);
  assert.equal(savedRoom.demoMode, true);
  assert.equal(JSON.stringify(afterBody).includes(secret), false);
  assert.equal(JSON.stringify(listedBody).includes(secret), false);

  const overlap = await fetch(`${origin}/api/admin/schedules`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      classroomId: byNumber['101'].id,
      dayOfWeek: 1,
      startTime: '08:00',
      endTime: '08:30',
      subject: 'Overlap',
      section: 'X',
      instructor: 'Y',
    }),
  });
  assert.equal(overlap.status, 409);
});
