/**
 * The BE writes UTC timestamps with no zone suffix ('2026-08-14T10:30:00').
 * Handing that straight to `new Date()` makes JS read it as local time, so
 * every timestamp in the console would be silently offset. Appending 'Z' is
 * the whole fix, and it belongs in exactly one place.
 */
export function parseUtc(ts: string): Date {
  // SQLite column defaults produce a space instead of the 'T'.
  return new Date(`${ts.replace(' ', 'T')}Z`);
}

/**
 * Renders in UTC on purpose: the operator is reading the same clock the BE
 * wrote, and a locale-formatted local time would not match the log lines or
 * the hour buckets they are comparing against.
 */
export function formatUtc(ts: string | null): string {
  if (!ts) return '—';
  const date = parseUtc(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
