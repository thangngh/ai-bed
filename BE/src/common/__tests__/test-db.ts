import { randomUUID } from 'node:crypto';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ALL_TEST_ENTITIES, TEMPLATE_DB } from './test-entities';

export const CORE_TOKEN = getDataSourceToken('core');

function adminUrl(): string {
  const url = process.env.TEST_PG_ADMIN_URL;
  if (!url) {
    throw new Error(
      'TEST_PG_ADMIN_URL is unset — jest globalSetup did not run. Is Docker running?',
    );
  }
  return url;
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * One throwaway database per caller, cloned from the migrated template.
 * Postgres copies the template's files, so a clone costs far less than
 * re-running the migrations, and each spec file stays isolated even when
 * Jest runs several in parallel workers.
 */
export async function openTestDataSource(): Promise<DataSource> {
  const dbName = `t_${randomUUID().replace(/-/g, '')}`;
  await withAdmin((c) =>
    c.query(`CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB}"`),
  );

  const url = new URL(adminUrl());
  const ds = new DataSource({
    type: 'postgres',
    host: url.hostname,
    port: Number(url.port),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    // Explicit host/port/username/database rather than `url` so that
    // closeTestDataSource can read the database name back off ds.options.
    database: dbName,
    entities: ALL_TEST_ENTITIES,
    synchronize: false,
    // Headroom for many parallel workers each holding a pool comes from
    // raising the container's own max_connections (see global-setup.ts),
    // not from shrinking this per-worker pool.
    extra: { max: 4 },
  });
  try {
    await ds.initialize();
  } catch (err) {
    // Don't leak the database just created above if the connection that
    // was supposed to use it never came up.
    await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${dbName}"`));
    throw err;
  }
  return ds;
}

export async function closeTestDataSource(ds: DataSource): Promise<void> {
  const dbName = ds.options.database as string;
  await ds.destroy();
  await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${dbName}"`));
}
