import { api, clear, el, formatStamp, sourceBadge } from './dom.js';

const content = document.querySelector('#content');
const id = new URLSearchParams(location.search).get('id');

function classLine(item) {
  if (!item) {
    return 'None';
  }
  return `${item.subject} · ${item.section} · ${item.instructor} (${item.startTime}–${item.endTime})`;
}

function render(room, timeZone) {
  clear(content);
  const todayRows = room.scheduleToday.map((item) => el('tr', { class: item.isCurrent ? 'current-row' : '' }, [
    el('td', {}, [`${item.startTime}–${item.endTime}`]),
    el('td', {}, [item.subject]),
    el('td', {}, [item.section]),
    el('td', {}, [item.instructor]),
    el('td', {}, [item.isCurrent ? 'Now' : item.isNext ? 'Upcoming' : '']),
  ]));
  content.append(
    el('section', { class: 'hero' }, [
      el('p', { class: 'clock' }, [`${room.building} · Floor ${room.floor}`]),
      el('h1', {}, [`Room ${room.roomNumber}`]),
      el('div', { class: 'actions' }, [
        el('span', { class: `status-pill pill-${room.status}` }, [room.statusLabel]),
        sourceBadge(room.dataSource),
      ]),
      el('p', {}, [room.sensorDetail]),
      el('p', { class: 'detail' }, [`Last trusted update: ${formatStamp(room.lastUpdate, timeZone)}`]),
    ]),
    el('section', { class: 'stats' }, [
      el('article', { class: 'stat' }, [el('span', {}, ['Current class']), el('strong', {}, [classLine(room.currentClass)])]),
      el('article', { class: 'stat' }, [el('span', {}, ['Upcoming today']), el('strong', {}, [classLine(room.nextClass)])]),
    ]),
    el('section', { class: 'table-wrap' }, [
      el('h2', {}, ["Today's timetable"]),
      todayRows.length
        ? el('table', {}, [
          el('thead', {}, [el('tr', {}, ['Time', 'Subject', 'Section', 'Instructor', 'Marker'].map((text) => el('th', {}, [text])))]),
          el('tbody', {}, todayRows),
        ])
        : el('p', {}, ['No classes are scheduled today.']),
    ]),
    el('section', { class: 'table-wrap' }, [
      el('h2', {}, ['Weekly timetable']),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, ['Day', 'Time', 'Subject', 'Section', 'Instructor'].map((text) => el('th', {}, [text])))]),
        el('tbody', {}, room.week.map((item) => el('tr', { class: item.isCurrent ? 'current-row' : '' }, [
          el('td', {}, [item.dayName]),
          el('td', {}, [`${item.startTime}–${item.endTime}`]),
          el('td', {}, [item.subject]),
          el('td', {}, [item.section]),
          el('td', {}, [item.instructor]),
        ]))),
      ]),
    ]),
  );
}

if (!id) {
  content.textContent = 'Open a classroom from the dashboard.';
} else {
  const refresh = async () => {
    try {
      const overview = await api('/api/overview');
      const room = await api(`/api/classrooms/${encodeURIComponent(id)}`);
      render(room, overview.timezone);
    } catch (error) {
      content.textContent = `${error.message} This page will not guess that the room is empty.`;
    }
  };
  refresh();
  setInterval(refresh, 5000);
}
