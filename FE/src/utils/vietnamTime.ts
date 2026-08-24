export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * SQLite stores UTC as `YYYY-MM-DD HH:mm:ss`, which browsers otherwise parse
 * as local time. Add the missing UTC marker before formatting it for parents.
 */
function parseUtcTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed);
  const parsed = new Date(sqliteUtc ? `${trimmed.replace(' ', 'T')}Z` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Stable Vietnamese display independent of the browser/device time zone. */
export function formatVietnamTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = parseUtcTimestamp(value);
  if (!date) return value;

  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: VIETNAM_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
