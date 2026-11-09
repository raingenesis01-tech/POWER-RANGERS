// Server-side Blynk HTTP API. The browser never receives the device token.

export function parseConnected(text) {
  const value = String(text).trim().toLowerCase();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error('Unexpected hardware status from Blynk.');
}

export function parsePinPayload(text) {
  const trimmed = String(text).trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('Unexpected Blynk payload.');
    }
    return parsed.map((value) => String(value).trim());
  }
  if (trimmed.includes('\n')) {
    return trimmed.split(/\r?\n/).map((value) => value.trim()).filter((value) => value.length > 0);
  }
  if (trimmed.includes(',')) {
    return trimmed.split(',').map((value) => value.trim());
  }
  return [trimmed];
}

async function requestText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

export async function readDevice({
  server = 'https://blynk.cloud',
  token,
  presencePin = 'V0',
  heartbeatPin = 'V1',
  timeoutMs = 5000,
}) {
  if (!/^V\d{1,3}$/.test(presencePin) || !/^V\d{1,3}$/.test(heartbeatPin)) {
    return { online: false, presence: null, heartbeat: null, error: 'The virtual pin name is invalid.' };
  }
  const base = String(server || 'https://blynk.cloud').replace(/\/$/, '');
  const tokenQuery = encodeURIComponent(token);
  try {
    const connected = await requestText(
      `${base}/external/api/isHardwareConnected?token=${tokenQuery}`,
      timeoutMs,
    );
    if (!connected.ok) {
      return {
        online: false,
        presence: null,
        heartbeat: null,
        error: `Blynk rejected the device check (${connected.status}).`,
      };
    }
    if (!parseConnected(connected.text)) {
      return { online: false, presence: null, heartbeat: null, error: null };
    }

    const combined = await requestText(
      `${base}/external/api/get?token=${tokenQuery}&${presencePin}&${heartbeatPin}`,
      timeoutMs,
    );
    let values = [];
    if (combined.ok) {
      try {
        values = parsePinPayload(combined.text);
      } catch {
        values = [];
      }
    }
    if (values.length < 2) {
      const presenceResponse = await requestText(
        `${base}/external/api/get?token=${tokenQuery}&${presencePin}`,
        timeoutMs,
      );
      const heartbeatResponse = await requestText(
        `${base}/external/api/get?token=${tokenQuery}&${heartbeatPin}`,
        timeoutMs,
      );
      if (!presenceResponse.ok || !heartbeatResponse.ok) {
        return {
          online: false,
          presence: null,
          heartbeat: null,
          error: 'Blynk did not return both virtual pins.',
        };
      }
      values = [presenceResponse.text.trim(), heartbeatResponse.text.trim()];
    }
    return { online: true, presence: values[0], heartbeat: values[1], error: null };
  } catch (error) {
    return {
      online: false,
      presence: null,
      heartbeat: null,
      error: error.name === 'AbortError' ? 'The Blynk request timed out.' : 'The server could not reach Blynk.',
    };
  }
}
