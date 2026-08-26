/**
 * Read-only check for rows that reference a tenant/child that doesn't exist.
 * Run before BE/scripts/migrate-core-to-postgres.ts, which adds FK
 * constraints that these rows would violate.
 *
 *   npm run check:core-orphans
 */
import { DataSource } from 'typeorm';
import 'dotenv/config';

interface OrphanCheck {
  label: string;
  sql: string;
}

const CHECKS: OrphanCheck[] = [
  {
    label: 'child_profiles.tenant_id -> tenants.tenant_id',
    sql: `
      SELECT cp.child_id, cp.tenant_id
      FROM child_profiles cp
      LEFT JOIN tenants t ON t.tenant_id = cp.tenant_id
      WHERE t.tenant_id IS NULL
    `,
  },
  {
    label: 'feedbacks.tenant_id -> tenants.tenant_id',
    sql: `
      SELECT f.feedback_id, f.tenant_id
      FROM feedbacks f
      LEFT JOIN tenants t ON t.tenant_id = f.tenant_id
      WHERE t.tenant_id IS NULL
    `,
  },
  {
    label: 'feedbacks.child_id -> child_profiles.child_id',
    sql: `
      SELECT f.feedback_id, f.child_id
      FROM feedbacks f
      LEFT JOIN child_profiles cp ON cp.child_id = f.child_id
      WHERE f.child_id IS NOT NULL AND cp.child_id IS NULL
    `,
  },
];

async function main(): Promise<void> {
  const database = process.env.CORE_DB_PATH || 'data/core.db';
  const ds = new DataSource({ type: 'sqlite', database });
  await ds.initialize();

  let totalOrphans = 0;
  for (const check of CHECKS) {
    const rows: unknown[] = await ds.query(check.sql);
    console.log(`${check.label}: ${rows.length} orphan row(s)`);
    if (rows.length > 0) {
      console.log(JSON.stringify(rows, null, 2));
      totalOrphans += rows.length;
    }
  }

  await ds.destroy();

  if (totalOrphans > 0) {
    console.error(`\n${totalOrphans} orphan row(s) found in ${database}. Resolve before migrating.`);
    process.exit(1);
  }
  console.log(`\nNo orphans found in ${database}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
