// Philippine Time currently uses UTC+08:00 without daylight-saving changes.
const OFFSET_MS = 8 * 60 * 60 * 1000;

function manilaDateTimeFields(value) {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' };
  const local = new Date(date.getTime() + OFFSET_MS).toISOString();
  let time = local.slice(11, 23);
  if (time.endsWith('.000')) time = time.slice(0, -4);
  if (time.endsWith(':00')) time = time.slice(0, -3);
  return { date: local.slice(0, 10), time };
}

function manilaDateTimeToIso(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(String(time || ''));
  if (!dateMatch || !timeMatch) return null;
  const [, year, month, day] = dateMatch.map(Number);
  const hour = Number(timeMatch[1]); const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || 0); const millisecond = Number((timeMatch[4] || '').padEnd(3, '0'));
  if (year < 100 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
  return new Date(local.getTime() - OFFSET_MS).toISOString();
}

module.exports = { manilaDateTimeFields, manilaDateTimeToIso };
