/**
 * One-shot, idempotent copy of the `core` datasource (tenants,
 * child_profiles, admin_users, feedbacks, 8 dashboard tables) from SQLite
 * into Postgres. Safe to re-run — every table is upserted by primary key.
 * Never writes to the SQLite source.
 *
 *   npm run migrate:core            # copies and verifies row counts
 *   npm run migrate:core -- --dry-run   # reports source counts only
 */
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import 'dotenv/config';
import PostgresDataSource from '../src/database/postgres-data-source';
import { Tenant } from '../src/modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../src/modules/child/entities/child-profile.entity';
import { Feedback } from '../src/modules/feedback/entities/feedback.entity';
import { AdminUser } from '../src/modules/admin/entities/admin-user.entity';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from '../src/modules/admin/dashboard/entities';

interface TableSpec {
  entity: EntityTarget<ObjectLiteral>;
  label: string;
  conflictColumns: string[];
}

// Order matters: FK-referenced tables (tenants, child_profiles) must be
// copied before the tables that reference them (feedbacks).
const CORE_TABLES: TableSpec[] = [
  { entity: Tenant, label: 'tenants', conflictColumns: ['tenantId'] },
  { entity: ChildProfile, label: 'child_profiles', conflictColumns: ['childId'] },
  { entity: AdminUser, label: 'admin_users', conflictColumns: ['adminId'] },
  { entity: Feedback, label: 'feedbacks', conflictColumns: ['feedbackId'] },
  { entity: TrafficEvent, label: 'traffic_event', conflictColumns: ['id'] },
  { entity: TrafficHourly, label: 'traffic_hourly', conflictColumns: ['ip', 'hourBucket', 'route', 'statusClass'] },
  { entity: LlmUsageEvent, label: 'llm_usage_event', conflictColumns: ['id'] },
  { entity: LlmUsageHourly, label: 'llm_usage_hourly', conflictColumns: ['provider', 'model', 'hourBucket'] },
  { entity: IpRule, label: 'ip_rules', conflictColumns: ['id'] },
  { entity: IpState, label: 'ip_states', conflictColumns: ['ip'] },
  { entity: Alert, label: 'alerts', conflictColumns: ['id'] },
  { entity: AdminSetting, label: 'admin_settings', conflictColumns: ['key'] },
];

function makeSqliteSource(): DataSource {
  const database = process.env.CORE_DB_PATH || 'data/core.db';
  return new DataSource({
    type: 'sqlite',
    database,
    entities: CORE_TABLES.map((t) => t.entity) as Function[],
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const sqlite = makeSqliteSource();
  await sqlite.initialize();
  await PostgresDataSource.initialize();

  let mismatches = 0;
  for (const table of CORE_TABLES) {
    const sourceRepo = sqlite.getRepository(table.entity);
    const rows = await sourceRepo.find();

    if (dryRun) {
      console.log(`[dry-run] ${table.label}: ${rows.length} row(s) would be copied`);
      continue;
    }

    if (rows.length > 0) {
      const targetRepo = PostgresDataSource.getRepository(table.entity);
      await targetRepo.upsert(rows, table.conflictColumns);
    }

    const sourceCount = rows.length;
    const targetCount = await PostgresDataSource.getRepository(table.entity).count();
    const status = sourceCount === targetCount ? 'OK' : 'MISMATCH';
    if (status === 'MISMATCH') mismatches += 1;
    console.log(`${table.label}: source=${sourceCount} target=${targetCount} ${status}`);
  }

  await sqlite.destroy();
  await PostgresDataSource.destroy();

  if (dryRun) return;

  if (mismatches > 0) {
    console.error(`\n${mismatches} table(s) have mismatched row counts. Investigate before cutting over.`);
    process.exit(1);
  }
  console.log('\nAll core tables copied; row counts match.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
