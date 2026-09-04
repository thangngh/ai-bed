/**
 * DB-side default for the `*_at` text columns. Reproduces the
 * 'YYYY-MM-DD HH:MM:SS' UTC shape that the pre-Postgres SQLite schema
 * produced with `datetime('now')`, because app code (vietnam-time.ts,
 * analytics.service.ts) parses these columns as plain strings in that shape.
 */
export const NOW_UTC_TEXT_EXPR =
  `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
