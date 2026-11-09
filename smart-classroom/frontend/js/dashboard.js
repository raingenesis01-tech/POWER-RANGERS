import { api, clear, el, formatStamp, sourceBadge } from './dom.js';

const totals = document.querySelector('#totals');
const cards = document.querySelector('#cards');
const clock = document.querySelector('#clock');
const banner = document.querySelector('#banner');
const search = document.querySelector('#search');
const status = document.querySelector('#status');
const building = document.querySelector('#building');
const floor = document.querySelector('#floor');
const source = document.querySelector('#source');
let latest = null;

function fillSelect(select, values, label) {
  const current = select.value;
  clear(select);
  select.append(el('option', { value: '' }, [label]));
  for (const value of values) {
    select.append(el('option', { value }, [String(value)]));
  }
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function matches(room) {
  const query = search.value.trim().toLowerCase();
  const text = [
    room.roomNumber,
    room.building,
    room.currentClass?.subject,
    room.currentClass?.instructor,
    room.currentClass?.section,
    ...room.scheduleToday.flatMap((item) => [item.subject, item.instructor, item.section]),
  ].join(' ').toLowerCase();
  if (query && !text.includes(query)) {
    return false;
  }
  if (status.value === 'NO_CLASS_TODAY' && room.hasScheduleToday) {
    return false;
  }
  if (status.value && status.value !== 'NO_CLASS_TODAY' && room.status !== status.value) {
    return false;
  }
  if (building.value && room.building !== building.value) {
    return false;
  }
  if (floor.value && String(room.floor) !== floor.value) {
    return false;
  }
  if (source.value && room.dataSource !== source.value) {
    return false;
  }
  return true;
}

function render() {
  if (!latest) {
    return;
  }
  clock.textContent = `${latest.schoolClock} · ${latest.timezone}`;
  const counts = latest.totals;
  clear(totals);
  for (const [label, value] of [
    ['Rooms monitored', counts.classrooms],
    ['Available', counts.available],
    ['Physically occupied', counts.physicallyOccupied],
    ['In class', counts.inClass],
    ['Occupied, no class', counts.occupied],
    ['Scheduled / empty', counts.scheduledEmpty],
    ['Sensor offline', counts.unknown],
    ['Devices online', counts.devicesOnline],
  ]) {
    totals.append(el('article', { class: 'stat' }, [
      el('span', {}, [label]),
      el('strong', {}, [value]),
    ]));
  }

  fillSelect(building, [...new Set(latest.classrooms.map((room) => room.building))], 'All buildings');
  fillSelect(floor, [...new Set(latest.classrooms.map((room) => String(room.floor)))], 'All floors');
  const visible = latest.classrooms.filter(matches);
  clear(cards);
  if (visible.length === 0) {
    cards.append(el('p', { class: 'notice' }, ['No classrooms match these filters.']));
    return;
  }
  for (const room of visible) {
    const current = room.currentClass
      ? `${room.currentClass.subject} · ${room.currentClass.section} · ${room.currentClass.instructor} · ${room.currentClass.startTime}–${room.currentClass.endTime}`
      : 'No class at this time';
    cards.append(el('a', { class: `card status-${room.status}`, href: `/classroom.html?id=${room.id}` }, [
      el('div', { class: 'actions' }, [
        el('span', { class: `status-pill pill-${room.status}` }, [room.statusLabel]),
        sourceBadge(room.dataSource),
      ]),
      el('h2', { class: 'room-number' }, [room.roomNumber]),
      el('p', { class: 'meta' }, [`${room.building} · Floor ${room.floor}`]),
      el('p', {}, [current]),
      el('p', { class: 'detail' }, [room.sensorDetail]),
      el('p', { class: 'detail' }, [`Last trusted update: ${formatStamp(room.lastUpdate, latest.timezone)}`]),
    ]));
  }
}

async function refresh() {
  try {
    latest = await api('/api/overview');
    render();
  } catch (error) {
    banner.textContent = latest
      ? `Showing the last successful update. Refresh failed: ${error.message}`
      : `No occupancy data is available because the server could not be reached. Rooms are not shown as empty. ${error.message}`;
  }
}

for (const input of [search, status, building, floor, source]) {
  input.addEventListener('input', render);
  input.addEventListener('change', render);
}

refresh();
setInterval(refresh, 5000);
