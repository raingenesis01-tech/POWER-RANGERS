import { api, clear, el } from './dom.js';

const loginForm = document.querySelector('#login-form');
const app = document.querySelector('#app');
const message = document.querySelector('#message');
const logoutButton = document.querySelector('#logout');
const roomForm = document.querySelector('#room-form');
const deviceForm = document.querySelector('#device-form');
const scheduleForm = document.querySelector('#schedule-form');
const roomTable = document.querySelector('#room-table');
const scheduleTable = document.querySelector('#schedule-table');
const deviceRoom = document.querySelector('#device-room');
const scheduleRoom = document.querySelector('#schedule-room');
let classrooms = [];

function say(text) {
  message.textContent = text;
}

function selectedRoom() {
  return classrooms.find((room) => String(room.id) === deviceRoom.value) || null;
}

function headerRow(labels) {
  return el('tr', {}, labels.map((label) => el('th', {}, [label])));
}

function showSelected(id = deviceRoom.value) {
  if (id && [...deviceRoom.options].some((option) => option.value === String(id))) {
    deviceRoom.value = String(id);
    scheduleRoom.value = String(id);
  }
  const room = selectedRoom();
  if (room) {
    deviceForm.elements.presencePin.value = room.presencePin;
    deviceForm.elements.heartbeatPin.value = room.heartbeatPin;
    deviceForm.elements.demoMode.checked = room.demoMode;
    deviceForm.elements.simulatedPresence.checked = room.simulatedPresence;
  }
  renderSchedule();
}

function renderRooms() {
  clear(roomTable);
  const body = el('tbody');
  for (const room of classrooms) {
    const source = room.dataSource === 'simulated' ? 'Simulated' : room.dataSource === 'blynk' ? 'Live sensor' : 'No device';
    body.append(el('tr', {}, [
      el('td', {}, [room.roomNumber, el('div', { class: 'detail' }, [`${room.building} · Floor ${room.floor}`])]),
      el('td', {}, [room.statusLabel, el('div', { class: 'detail' }, [source])]),
      el('td', {}, [room.hasToken ? 'Token saved' : 'No token', el('div', { class: 'detail' }, [room.adminDetail || ''])]),
      el('td', {}, [el('div', { class: 'actions' }, [
        el('button', { class: 'secondary', type: 'button', onclick: () => editRoom(room) }, ['Edit']),
        el('button', { class: 'secondary', type: 'button', onclick: () => showSelected(room.id) }, ['Select']),
        el('button', { class: 'danger', type: 'button', onclick: () => removeRoom(room) }, ['Delete']),
      ])]),
    ]));
  }
  roomTable.append(el('table', {}, [el('thead', {}, [headerRow(['Room', 'Status', 'Blynk', ''])]), body]));
}

function renderSchedule() {
  const room = selectedRoom();
  clear(scheduleTable);
  if (!room) {
    scheduleTable.append(el('p', {}, ['Add a classroom before adding classes.']));
    return;
  }
  const body = el('tbody');
  for (const item of room.schedules) {
    body.append(el('tr', { class: item.isCurrent ? 'current-row' : '' }, [
      el('td', {}, [item.isCurrent ? `${item.dayName} · now` : item.dayName]),
      el('td', {}, [`${item.startTime}–${item.endTime}`]),
      el('td', {}, [item.subject, el('div', { class: 'detail' }, [`${item.section} · ${item.instructor}`])]),
      el('td', {}, [el('div', { class: 'actions' }, [
        el('button', { class: 'secondary', type: 'button', onclick: () => editSchedule(item) }, ['Edit']),
        el('button', { class: 'danger', type: 'button', onclick: () => removeSchedule(item) }, ['Delete']),
      ])]),
    ]));
  }
  scheduleTable.append(el('table', {}, [el('thead', {}, [headerRow(['Day', 'Time', 'Class', ''])]), body]));
}

function fillSelects(preferredId) {
  const current = preferredId || deviceRoom.value;
  clear(deviceRoom);
  clear(scheduleRoom);
  for (const room of classrooms) {
    const label = `${room.roomNumber} · ${room.building}`;
    deviceRoom.append(el('option', { value: room.id }, [label]));
    scheduleRoom.append(el('option', { value: room.id }, [label]));
  }
  showSelected(current);
}

function editRoom(room) {
  roomForm.elements.id.value = room.id;
  roomForm.elements.roomNumber.value = room.roomNumber;
  roomForm.elements.building.value = room.building;
  roomForm.elements.floor.value = room.floor;
  document.querySelector('#room-form-title').textContent = `Edit room ${room.roomNumber}`;
}

function editSchedule(item) {
  scheduleForm.elements.id.value = item.id;
  scheduleForm.elements.classroomId.value = String(item.classroomId);
  scheduleForm.elements.dayOfWeek.value = String(item.dayOfWeek);
  scheduleForm.elements.startTime.value = item.startTime;
  scheduleForm.elements.endTime.value = item.endTime;
  scheduleForm.elements.subject.value = item.subject;
  scheduleForm.elements.section.value = item.section;
  scheduleForm.elements.instructor.value = item.instructor;
  document.querySelector('#schedule-title').textContent = 'Edit class';
  showSelected(item.classroomId);
}

async function load() {
  const data = await api('/api/admin/classrooms');
  classrooms = data.classrooms;
  fillSelects();
  renderRooms();
}

async function removeRoom(room) {
  if (!window.confirm(`Delete room ${room.roomNumber} and its whole schedule?`)) {
    return;
  }
  try {
    await api(`/api/admin/classrooms/${room.id}`, { method: 'DELETE' });
    say(`Deleted room ${room.roomNumber}.`);
    await load();
  } catch (error) {
    say(error.message);
  }
}

async function removeSchedule(item) {
  if (!window.confirm(`Delete ${item.subject}?`)) {
    return;
  }
  try {
    await api(`/api/admin/schedules/${item.id}`, { method: 'DELETE' });
    say('Class deleted.');
    await load();
  } catch (error) {
    say(error.message);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: new FormData(loginForm).get('password') }),
    });
    loginForm.classList.add('hidden');
    app.classList.remove('hidden');
    logoutButton.classList.remove('hidden');
    say('Signed in on this browser.');
    await load();
  } catch (error) {
    say(error.message);
  }
});

logoutButton.addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  window.location.reload();
});

roomForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(roomForm).entries());
  data.floor = Number(data.floor);
  data.demoMode = roomForm.elements.demoMode.checked;
  data.simulatedPresence = roomForm.elements.simulatedPresence.checked;
  try {
    if (data.id) {
      await api(`/api/admin/classrooms/${data.id}`, { method: 'PUT', body: JSON.stringify(data) });
      say('Classroom updated. Change simulation from the Blynk device form.');
    } else {
      await api('/api/admin/classrooms', { method: 'POST', body: JSON.stringify(data) });
      say('Classroom added.');
    }
    roomForm.reset();
    document.querySelector('#room-form-title').textContent = 'Add a classroom';
    await load();
  } catch (error) {
    say(error.message);
  }
});

document.querySelector('#reset-room').addEventListener('click', () => {
  roomForm.reset();
  document.querySelector('#room-form-title').textContent = 'Add a classroom';
});

deviceRoom.addEventListener('change', () => showSelected(deviceRoom.value));
scheduleRoom.addEventListener('change', () => showSelected(scheduleRoom.value));

deviceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const room = selectedRoom();
  if (!room) {
    return;
  }
  const payload = {
    blynkToken: deviceForm.elements.blynkToken.value,
    clearToken: deviceForm.elements.clearToken.checked,
    presencePin: deviceForm.elements.presencePin.value,
    heartbeatPin: deviceForm.elements.heartbeatPin.value,
    demoMode: deviceForm.elements.demoMode.checked,
    simulatedPresence: deviceForm.elements.simulatedPresence.checked,
  };
  try {
    await api(`/api/admin/classrooms/${room.id}/device`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    deviceForm.elements.blynkToken.value = '';
    deviceForm.elements.clearToken.checked = false;
    say(payload.demoMode
      ? 'Saved. This room stays labeled Simulated until simulation is turned off.'
      : 'Saved. The server will read Blynk with this token.');
    await load();
  } catch (error) {
    say(error.message);
  }
});

scheduleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(scheduleForm).entries());
  data.classroomId = Number(data.classroomId);
  data.dayOfWeek = Number(data.dayOfWeek);
  try {
    if (data.id) {
      await api(`/api/admin/schedules/${data.id}`, { method: 'PUT', body: JSON.stringify(data) });
      say('Class updated.');
    } else {
      await api('/api/admin/schedules', { method: 'POST', body: JSON.stringify(data) });
      say('Class added.');
    }
    const keepRoom = data.classroomId;
    scheduleForm.reset();
    document.querySelector('#schedule-title').textContent = 'Add a class';
    await load();
    showSelected(keepRoom);
  } catch (error) {
    say(error.message);
  }
});

document.querySelector('#reset-schedule').addEventListener('click', () => {
  scheduleForm.reset();
  document.querySelector('#schedule-title').textContent = 'Add a class';
});

const session = await api('/api/admin/session');
if (!session.adminEnabled) {
  say('Copy .env.example to .env, set ADMIN_PASSWORD, and restart the server.');
  loginForm.querySelector('button').disabled = true;
} else if (session.authenticated) {
  loginForm.classList.add('hidden');
  app.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
  await load();
}
