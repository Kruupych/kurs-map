const DAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DAY_MINUTES = 24 * 60;
const MINSK_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Minsk',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

export function minskNow(date = new Date()) {
  const parts = Object.fromEntries(MINSK_CLOCK.formatToParts(date).map((part) => [part.type, part.value]));
  return { day: WEEKDAY_INDEX[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function openingStatus(schedule, now) {
  if (!Array.isArray(schedule) || schedule.length !== 7) return null;
  const today = dayInterval(schedule, now.day);
  const yesterday = dayInterval(schedule, (now.day + 6) % 7);
  if (yesterday && now.minutes < yesterday.end - DAY_MINUTES) {
    return { open: true, text: closingText(yesterday.end - DAY_MINUTES - now.minutes, yesterday.end) };
  }
  if (today && now.minutes >= today.start && now.minutes < today.end) {
    if (today.start === 0 && today.end >= DAY_MINUTES - 1) return { open: true, text: 'круглосуточно' };
    return { open: true, text: closingText(today.end - now.minutes, today.end) };
  }
  return { open: false, text: nextOpeningText(schedule, now) };
}

function dayInterval(schedule, day) {
  const [open, close] = schedule[day] ?? [];
  if (!open || !close) return null;
  const start = toMinutes(open);
  const end = toMinutes(close);
  if (start === end) return null;
  return { start, end: end < start ? end + DAY_MINUTES : end };
}

function closingText(minutesLeft, end) {
  if (minutesLeft <= 60) return `закроется через ${minutesLeft} мин`;
  return `открыто до ${formatTime(end % DAY_MINUTES)}`;
}

function nextOpeningText(schedule, now) {
  const today = dayInterval(schedule, now.day);
  if (today && now.minutes < today.start) return `закрыто, откроется в ${formatTime(today.start)}`;
  for (let offset = 1; offset <= 7; offset++) {
    const day = (now.day + offset) % 7;
    const interval = dayInterval(schedule, day);
    if (!interval) continue;
    const when = offset === 1 ? 'завтра' : DAY_NAMES[day];
    return `закрыто, откроется ${when} в ${formatTime(interval.start)}`;
  }
  return 'закрыто';
}

function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
