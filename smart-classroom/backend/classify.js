import { DAY_NAMES } from './time.js';

export const STATUS = {
  IN_CLASS: 'IN_CLASS',
  OCCUPIED: 'OCCUPIED',
  AVAILABLE: 'AVAILABLE',
  SCHEDULED_EMPTY: 'SCHEDULED_EMPTY',
  UNKNOWN: 'UNKNOWN',
};

export const STATUS_LABELS = {
  IN_CLASS: 'In class',
  OCCUPIED: 'Occupied',
  AVAILABLE: 'Available',
  SCHEDULED_EMPTY: 'Scheduled / empty',
  UNKNOWN: 'Sensor offline',
};

// End time may be 24:00, meaning the block stops at midnight.
export function timeToMinutes(value, allowMidnightEnd = false) {
  if (allowMidnightEnd && value === '24:00') {
    return 24 * 60;
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function isCurrentClass(schedule, minutes) {
  const start = timeToMinutes(schedule.start_time);
  const end = timeToMinutes(schedule.end_time, true);
  if (start === null || end === null || end <= start) {
    return false;
  }
  return start <= minutes && minutes < end;
}

// A scheduled class is not occupancy. A missing sensor is not an empty room.
export function classify({ sensorOnline, presence, scheduled }) {
  if (!sensorOnline || (presence !== true && presence !== false)) {
    return STATUS.UNKNOWN;
  }
  if (scheduled && presence) {
    return STATUS.IN_CLASS;
  }
  if (!scheduled && presence) {
    return STATUS.OCCUPIED;
  }
  if (!scheduled && !presence) {
    return STATUS.AVAILABLE;
  }
  return STATUS.SCHEDULED_EMPTY;
}

export function decorateSchedules(schedules, clock) {
  const decorated = schedules.map((item) => ({
    id: item.id,
    classroomId: item.classroom_id,
    dayOfWeek: item.day_of_week,
    dayName: DAY_NAMES[item.day_of_week],
    startTime: item.start_time,
    endTime: item.end_time,
    subject: item.subject,
    section: item.section,
    instructor: item.instructor,
    isCurrent: item.day_of_week === clock.dayOfWeek && isCurrentClass(item, clock.minutes),
    isNext: false,
  }));

  const next = decorated
    .filter((item) => item.dayOfWeek === clock.dayOfWeek && timeToMinutes(item.startTime) > clock.minutes)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0];
  if (next) {
    next.isNext = true;
  }

  decorated.sort((a, b) => a.dayOfWeek - b.dayOfWeek || timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  return decorated;
}
