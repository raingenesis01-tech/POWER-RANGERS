export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// School clock, independent of the laptop's timezone setting.
export function schoolClock(timeZone, date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }
  let hour = Number(parts.hour);
  if (hour === 24) {
    hour = 0;
  }
  const dayOfWeek = WEEKDAY_INDEX[parts.weekday];
  const minutes = hour * 60 + Number(parts.minute);
  return {
    timeZone,
    dayOfWeek,
    minutes,
    weekdayName: DAY_NAMES[dayOfWeek],
    dateLabel: `${parts.year}-${parts.month}-${parts.day}`,
    label: `${DAY_NAMES[dayOfWeek]} ${String(hour).padStart(2, '0')}:${parts.minute}`,
  };
}
