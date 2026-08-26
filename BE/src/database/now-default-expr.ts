import { QueryRunner } from 'typeorm';

/**
 * The pre-migration SQLite schema used `datetime('now')` as the DB-side
 * default for *_at text columns, producing 'YYYY-MM-DD HH:MM:SS' in UTC.
 * Postgres has no `datetime()` function, so migrations pick the
 * dialect-appropriate expression that reproduces the same text format —
 * existing app code parses these columns as plain strings in that shape.
 */
export function nowDefaultExpr(queryRunner: QueryRunner): string {
  return queryRunner.connection.options.type === 'postgres'
    ? `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`
    : `(datetime('now'))`;
}
