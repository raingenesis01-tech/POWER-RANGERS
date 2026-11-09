// Decides whether a Blynk reading is fresh enough to classify a room.
// The heartbeat must change. A stuck value of 0 is not proof that the room is empty.
export function judgeHeartbeat(previous, reading, now, staleMs) {
  const offline = (reason, lastUpdate = null) => ({
    memory: { online: false, value: null, changedAt: now },
    sensorOnline: false,
    presence: null,
    lastUpdate,
    reason,
  });

  if (!reading || reading.online !== true) {
    return offline(reading?.error || 'The device is offline in Blynk.');
  }

  const heartbeat = Number(reading.heartbeat);
  const presence = Number(reading.presence);
  if (!Number.isFinite(heartbeat) || (presence !== 0 && presence !== 1)) {
    return offline('Blynk did not return a usable presence value and heartbeat.');
  }

  let changedAt = now;
  if (previous && previous.online === true && previous.value === heartbeat) {
    changedAt = previous.changedAt;
  }
  const memory = { online: true, value: heartbeat, changedAt };
  if (now - changedAt > staleMs) {
    return {
      memory,
      sensorOnline: false,
      presence: null,
      lastUpdate: new Date(changedAt).toISOString(),
      reason: 'The heartbeat stopped changing. The last presence value is not used.',
    };
  }

  return {
    memory,
    sensorOnline: true,
    presence: presence === 1,
    lastUpdate: new Date(now).toISOString(),
    reason: null,
  };
}
