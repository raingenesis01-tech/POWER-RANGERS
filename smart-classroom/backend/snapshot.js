import { classify, decorateSchedules, STATUS_LABELS } from './classify.js';
import { schoolClock } from './time.js';

function classSummary(item) {
  if (!item) {
    return null;
  }
  return {
    subject: item.subject,
    section: item.section,
    instructor: item.instructor,
    startTime: item.startTime,
    endTime: item.endTime,
  };
}

export function buildSnapshot({ rooms, schedules, sensors, timeZone, now = new Date() }) {
  const clock = schoolClock(timeZone, now);
  const classrooms = rooms.map((room) => {
    const sensor = sensors.get(room.id) || {
      sensorOnline: false,
      presence: null,
      dataSource: 'none',
      lastUpdate: null,
      publicDetail: 'No sensor reading is available. This room is not marked available.',
      adminDetail: 'The server has no reading for this room yet.',
    };
    const decorated = decorateSchedules(
      schedules.filter((item) => item.classroom_id === room.id),
      clock,
    );
    const current = decorated.find((item) => item.isCurrent) || null;
    const next = decorated.find((item) => item.isNext) || null;
    const status = classify({
      sensorOnline: sensor.sensorOnline,
      presence: sensor.presence,
      scheduled: Boolean(current),
    });
    return {
      id: room.id,
      roomNumber: room.room_number,
      building: room.building,
      floor: room.floor,
      status,
      statusLabel: STATUS_LABELS[status],
      sensorOnline: sensor.sensorOnline,
      dataSource: sensor.dataSource,
      presence: sensor.sensorOnline ? sensor.presence : null,
      lastUpdate: sensor.lastUpdate,
      sensorDetail: sensor.publicDetail,
      adminDetail: sensor.adminDetail,
      currentClass: classSummary(current),
      nextClass: classSummary(next),
      hasScheduleToday: decorated.some((item) => item.dayOfWeek === clock.dayOfWeek),
      scheduleToday: decorated.filter((item) => item.dayOfWeek === clock.dayOfWeek),
      week: decorated,
    };
  });

  const count = (status) => classrooms.filter((room) => room.status === status).length;
  return {
    generatedAt: now.toISOString(),
    timezone: timeZone,
    schoolClock: clock.label,
    schoolDate: clock.dateLabel,
    weekday: clock.weekdayName,
    totals: {
      classrooms: classrooms.length,
      inClass: count('IN_CLASS'),
      occupied: count('OCCUPIED'),
      available: count('AVAILABLE'),
      scheduledEmpty: count('SCHEDULED_EMPTY'),
      unknown: count('UNKNOWN'),
      physicallyOccupied: count('IN_CLASS') + count('OCCUPIED'),
      devicesOnline: classrooms.filter((room) => room.sensorOnline).length,
      devicesOffline: classrooms.filter((room) => !room.sensorOnline).length,
    },
    classrooms,
  };
}
