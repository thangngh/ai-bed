import { DataSource } from 'typeorm';
import 'dotenv/config';
import { Tenant } from '../src/modules/tenant/entities/tenant.entity';

async function main() {
  const database = process.env.CORE_DB_PATH || 'data/core.db';
  const ds = new DataSource({ type: 'sqlite', database, entities: [Tenant] });
  await ds.initialize();

  await ds.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'anonymous',
      auth_type TEXT NOT NULL DEFAULT 'local',
      auth_key TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  console.log(`Ensured tenants table exists in ${database}`);
  await ds.destroy();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
