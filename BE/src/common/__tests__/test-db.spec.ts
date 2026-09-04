import { DataSource } from 'typeorm';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { openTestDataSource, closeTestDataSource } from './test-db';

const EXPECTED_TABLES = [
  'tenants', 'child_profiles', 'feedbacks', 'admin_users', 'tenant_sessions',
  'traffic_event', 'traffic_hourly', 'llm_usage_event', 'llm_usage_hourly',
  'ip_rules', 'ip_states', 'alerts', 'admin_settings',
  'stories', 'story_sections', 'memory_items',
];

describe('Postgres test harness', () => {
  let a: DataSource;
  let b: DataSource;

  beforeAll(async () => {
    a = await openTestDataSource();
    b = await openTestDataSource();
  });

  afterAll(async () => {
    await closeTestDataSource(a);
    await closeTestDataSource(b);
  });

  it('clones the fully migrated schema', async () => {
    const rows: { table_name: string }[] = await a.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name != 'migrations'`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      [...EXPECTED_TABLES].sort(),
    );
  });

  it('isolates writes between two datasources', async () => {
    await a.getRepository(Tenant).insert({ tenantId: 'iso-1', name: 'a' });

    expect(await a.getRepository(Tenant).count()).toBe(1);
    expect(await b.getRepository(Tenant).count()).toBe(0);
  });

  it('applies the Postgres-side created_at default in the plain text timestamp shape', async () => {
    await a.getRepository(Tenant).insert({ tenantId: 'iso-2', name: 'b' });

    const row = await a.getRepository(Tenant).findOneByOrFail({ tenantId: 'iso-2' });
    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
