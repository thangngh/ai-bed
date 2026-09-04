import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../../modules/child/entities/child-profile.entity';
import { Feedback } from '../../modules/feedback/entities/feedback.entity';
import { AdminUser } from '../../modules/admin/entities/admin-user.entity';
import { TenantSession } from '../../modules/auth/entities/tenant-session.entity';
import { Story } from '../../modules/story/entities/story.entity';
import { StorySection } from '../../modules/story/entities/story-section.entity';
import { MemoryItem } from '../../modules/memory/entities/memory-item.entity';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from '../../modules/admin/dashboard/entities';

const EXPECTED_TABLES = [
  'tenants', 'child_profiles', 'feedbacks', 'admin_users',
  'traffic_event', 'traffic_hourly', 'llm_usage_event', 'llm_usage_hourly',
  'ip_rules', 'ip_states', 'alerts', 'admin_settings',
  'stories', 'story_sections', 'memory_items',
  'tenant_sessions',
];

describe('Postgres migrations', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [
        Tenant, ChildProfile, Feedback, AdminUser, TenantSession,
        TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
        IpRule, IpState, Alert, AdminSetting,
        Story, StorySection, MemoryItem,
      ],
      migrations: [__dirname + '/../migrations/*.ts'],
      synchronize: false,
    });
    await dataSource.initialize();
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  it('creates all 16 tables', async () => {
    await dataSource.runMigrations();

    const rows: { table_name: string }[] = await dataSource.query(
      // Exclude TypeORM's own migration-tracking table ("migrations"), which
      // is not part of the application schema under test.
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != 'migrations'`,
    );
    const tableNames = rows.map((r) => r.table_name).sort();

    expect(tableNames).toEqual([...EXPECTED_TABLES].sort());
  });

  it('creates the expected foreign keys', async () => {
    const rows: { table_name: string; constraint_name: string }[] = await dataSource.query(`
      SELECT tc.table_name, tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);
    const tablesWithFks = rows.map((r) => r.table_name).sort();

    expect(tablesWithFks).toEqual(
      ['child_profiles', 'feedbacks', 'feedbacks', 'story_sections', 'tenant_sessions'].sort(),
    );
  });

  it('reverts all migrations cleanly', async () => {
    const migrationCount = dataSource.migrations.length;
    for (let i = 0; i < migrationCount; i++) {
      await dataSource.undoLastMigration();
    }

    const rows: { table_name: string }[] = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    // Once every migration's down() has run, the only thing left in the
    // public schema should be TypeORM's own migration-tracking table — no
    // application table should survive a full revert.
    expect(rows.map((r) => r.table_name)).toEqual(['migrations']);

    // Restore schema so a re-run of this file (e.g. --watch) starts clean.
    await dataSource.runMigrations();
  });

  it('leaves no dual-write control columns on tenants', async () => {
    const rows: { column_name: string }[] = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenants'`,
    );
    const columns = rows.map((r) => r.column_name);

    expect(columns).not.toContain('storage_backend');
    expect(columns).not.toContain('migrated_at');
  });
});
