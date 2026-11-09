import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConnected, parsePinPayload } from './blynk.js';
import { classify, isCurrentClass, rangesOverlap, timeToMinutes } from './classify.js';
import { judgeHeartbeat } from './heartbeat.js';

test('classifies schedule and presence independently', () => {
  assert.equal(classify({ sensorOnline: true, presence: true, scheduled: true }), 'IN_CLASS');
  assert.equal(classify({ sensorOnline: true, presence: true, scheduled: false }), 'OCCUPIED');
  assert.equal(classify({ sensorOnline: true, presence: false, scheduled: false }), 'AVAILABLE');
  assert.equal(classify({ sensorOnline: true, presence: false, scheduled: true }), 'SCHEDULED_EMPTY');
});

test('does not call a room available when the sensor cannot be trusted', () => {
  assert.equal(classify({ sensorOnline: false, presence: false, scheduled: false }), 'UNKNOWN');
  assert.equal(classify({ sensorOnline: false, presence: false, scheduled: true }), 'UNKNOWN');
  assert.equal(classify({ sensorOnline: true, presence: null, scheduled: false }), 'UNKNOWN');
});

test('class time includes the start minute and excludes the end minute', () => {
  const block = { start_time: '09:00', end_time: '10:00' };
  assert.equal(isCurrentClass(block, timeToMinutes('09:00')), true);
  assert.equal(isCurrentClass(block, timeToMinutes('09:59')), true);
  assert.equal(isCurrentClass(block, timeToMinutes('10:00')), false);
  assert.equal(rangesOverlap(9 * 60, 10 * 60, 10 * 60, 11 * 60), false);
  assert.equal(rangesOverlap(9 * 60, 10 * 60, 9 * 60 + 30, 11 * 60), true);
});

test('parses Blynk HTTP responses', () => {
  assert.equal(parseConnected('true\n'), true);
  assert.equal(parseConnected('false'), false);
  assert.deepEqual(parsePinPayload('1\n42'), ['1', '42']);
  assert.deepEqual(parsePinPayload('["0","7"]'), ['0', '7']);
  assert.deepEqual(parsePinPayload('0, 15'), ['0', '15']);
});

test('stale heartbeat is not treated as an empty room', () => {
  const first = judgeHeartbeat(null, { online: true, presence: '1', heartbeat: '5' }, 1_000, 45_000);
  assert.equal(first.sensorOnline, true);
  assert.equal(first.presence, true);

  const stale = judgeHeartbeat(first.memory, { online: true, presence: '0', heartbeat: '5' }, 50_000, 45_000);
  assert.equal(stale.sensorOnline, false);
  assert.equal(stale.presence, null);

  const offline = judgeHeartbeat(first.memory, { online: false, presence: null, heartbeat: null }, 50_000, 45_000);
  const resumed = judgeHeartbeat(offline.memory, { online: true, presence: '0', heartbeat: '5' }, 60_000, 45_000);
  assert.equal(resumed.sensorOnline, true);
  assert.equal(resumed.presence, false);
});

test('an offline device stays unknown even if the old value was empty', () => {
  const judged = judgeHeartbeat(
    { online: true, value: 3, changedAt: 0 },
    { online: false, presence: '0', heartbeat: '3', error: null },
    10_000,
    45_000,
  );
  assert.equal(judged.sensorOnline, false);
  assert.equal(judged.presence, null);
});
