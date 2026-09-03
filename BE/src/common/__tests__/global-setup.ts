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
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();

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
