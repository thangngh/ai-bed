import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ALL_TEST_ENTITIES, TEMPLATE_DB } from './test-entities';

/**
 * Starts one Postgres container for the whole run, migrates a template
 * database, then hands workers its admin connection string through
 * process.env. Jest forks its workers after globalSetup returns, so they
 * inherit the variable; `globalThis` would not survive the process boundary,
 * which is why only the container handle (needed by globalTeardown, same
 * process) is stashed there.
 */
export default async function globalSetup(): Promise<void> {
  // Every spec file will eventually open its own pooled DataSource (see
  // test-db.ts's `extra: { max: 4 }`) against this one container, and Jest
  // runs multiple spec files in parallel workers. Postgres's stock
  // max_connections=100 is comfortably exceeded once enough suites are on
  // the harness, so raise the server's own limit rather than throttling
  // Jest's worker count.
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withCommand(['postgres', '-c', 'max_connections=200'])
    .start();

  // The admin URL targets the always-present `postgres` maintenance database.
  // CREATE DATABASE and DROP DATABASE cannot run from inside the database
  // being created or dropped.
  const adminUrl =
    `postgresql://${container.getUsername()}:${container.getPassword()}` +
    `@${container.getHost()}:${container.getPort()}/postgres`;

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
  await admin.end();

  const template = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: TEMPLATE_DB,
    entities: ALL_TEST_ENTITIES,
    migrations: [__dirname + '/../../database/migrations/*.ts'],
    synchronize: false,
  });
  await template.initialize();
  await template.runMigrations();
  // Postgres refuses `CREATE DATABASE ... TEMPLATE` while any session is
  // attached to the source, so this destroy() is load-bearing, not cleanup.
  await template.destroy();

  process.env.TEST_PG_ADMIN_URL = adminUrl;
  (globalThis as any).__PG_CONTAINER__ = container;
}
