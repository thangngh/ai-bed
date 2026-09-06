const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function parseStoredUtc(value: string | Date): Date {
  if (value instanceof Date) return value;
  const trimmed = value.trim();
  const plainUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed);
  return new Date(plainUtc ? `${trimmed.replace(' ', 'T')}Z` : trimmed);
}

/** Convert a UTC timestamp into its YYYY-MM-DD calendar date in Vietnam. */
export function vietnamDateKey(value: string | Date): string {
  const utc = parseStoredUtc(value);
  return new Date(utc.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Admin date inputs represent a Vietnam calendar day. Database timestamps are
 * UTC strings, so their query boundaries must be shifted back seven hours.
 */
export function vietnamDateBoundaryUtc(date: string, endOfDay = false): string {
  const [year, month, day] = date.split('-').map(Number);
  const vietnamWallClockAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
  );
  return new Date(vietnamWallClockAsUtc - VIETNAM_OFFSET_MS)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}
