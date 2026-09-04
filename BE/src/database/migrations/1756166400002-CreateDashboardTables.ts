import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../now-default-expr';

export class CreateDashboardTables1756166400002 implements MigrationInterface {
  name = 'CreateDashboardTables1756166400002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = NOW_UTC_TEXT_EXPR;

    await queryRunner.createTable(
      new Table({
        name: 'traffic_event',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'ip', type: 'varchar', length: '64' },
          { name: 'route', type: 'varchar', length: '64' },
          { name: 'method', type: 'varchar', length: '64' },
          { name: 'status', type: 'int' },
          { name: 'bytesIn', type: 'integer', default: 0 },
          { name: 'bytesOut', type: 'integer', default: 0 },
          { name: 'lat_ms', type: 'real', default: 0 },
          { name: 'ts', type: 'varchar', length: '25' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex('traffic_event', new TableIndex({ columnNames: ['ts'] }));

    await queryRunner.createTable(
      new Table({
        name: 'traffic_hourly',
        columns: [
          { name: 'ip', type: 'varchar', length: '64', isPrimary: true },
          { name: 'hour_bucket', type: 'varchar', length: '19', isPrimary: true },
          { name: 'route', type: 'varchar', length: '128', isPrimary: true },
          { name: 'status_class', type: 'varchar', length: '8', isPrimary: true },
          { name: 'req_count', type: 'integer', default: 0 },
          { name: 'bytes_in', type: 'integer', default: 0 },
          { name: 'bytes_out', type: 'integer', default: 0 },
          { name: 'lat_avg_ms', type: 'real', default: 0 },
          { name: 'lat_p95_max_ms', type: 'real', default: 0 },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'llm_usage_event',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'provider', type: 'varchar', length: '32' },
          { name: 'model', type: 'varchar', length: '64' },
          { name: 'tenant_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'prompt_tokens', type: 'integer', default: 0 },
          { name: 'completion_tokens', type: 'integer', default: 0 },
          { name: 'est_cost_usd', type: 'real', default: 0 },
          { name: 'latency_ms', type: 'real', default: 0 },
          { name: 'is_fallback', type: 'boolean', default: false },
          { name: 'ts', type: 'varchar', length: '25' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex('llm_usage_event', new TableIndex({ columnNames: ['ts'] }));

    await queryRunner.createTable(
      new Table({
        name: 'llm_usage_hourly',
        columns: [
          { name: 'provider', type: 'varchar', length: '32', isPrimary: true },
          { name: 'model', type: 'varchar', length: '64', isPrimary: true },
          { name: 'hour_bucket', type: 'varchar', length: '19', isPrimary: true },
          { name: 'prompt_tokens', type: 'integer', default: 0 },
          { name: 'completion_tokens', type: 'integer', default: 0 },
          { name: 'requests', type: 'integer', default: 0 },
          { name: 'est_cost_usd', type: 'real', default: 0 },
          { name: 'lat_avg_ms', type: 'real', default: 0 },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'ip_rules',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'type', type: 'varchar', length: '8' },
          { name: 'pattern', type: 'varchar', length: '64' },
          { name: 'action', type: 'varchar', length: '8' },
          { name: 'tier', type: 'varchar', length: '32', default: `'default'` },
          { name: 'note', type: 'text', isNullable: true },
          { name: 'created_by', type: 'varchar', length: '64' },
          { name: 'created_at', type: 'varchar', length: '25', default: now },
          { name: 'enabled', type: 'boolean', default: true },
        ],
      }),
      true,
    );
    await queryRunner.createIndex('ip_rules', new TableIndex({ columnNames: ['enabled'] }));
    await queryRunner.createIndex('ip_rules', new TableIndex({ columnNames: ['pattern'] }));

    await queryRunner.createTable(
      new Table({
        name: 'ip_states',
        columns: [
          { name: 'ip', type: 'varchar', length: '64', isPrimary: true },
          { name: 'status', type: 'varchar', length: '16', default: `'ok'` },
          { name: 'tier', type: 'varchar', length: '32', default: `'default'` },
          { name: 'score', type: 'real', default: 0 },
          { name: 'blocked_until', type: 'varchar', length: '25', isNullable: true },
          { name: 'auto_blocked', type: 'boolean', default: false },
          { name: 'reason', type: 'text', isNullable: true },
          { name: 'updated_at', type: 'varchar', length: '25', default: now },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'alerts',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'type', type: 'varchar', length: '64' },
          { name: 'severity', type: 'varchar', length: '16' },
          { name: 'ip', type: 'varchar', length: '64', isNullable: true },
          { name: 'provider', type: 'varchar', length: '32', isNullable: true },
          { name: 'detail_json', type: 'text' },
          { name: 'resolved', type: 'boolean', default: false },
          { name: 'created_at', type: 'varchar', length: '25', default: now },
          { name: 'resolved_at', type: 'varchar', length: '25', isNullable: true },
        ],
      }),
      true,
    );
    await queryRunner.createIndex('alerts', new TableIndex({ columnNames: ['resolved', 'created_at'] }));

    await queryRunner.createTable(
      new Table({
        name: 'admin_settings',
        columns: [
          { name: 'key', type: 'varchar', length: '128', isPrimary: true },
          { name: 'value', type: 'text' },
          { name: 'updated_at', type: 'varchar', length: '25', default: now },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('admin_settings', true);
    await queryRunner.dropTable('alerts', true);
    await queryRunner.dropTable('ip_states', true);
    await queryRunner.dropTable('ip_rules', true);
    await queryRunner.dropTable('llm_usage_hourly', true);
    await queryRunner.dropTable('llm_usage_event', true);
    await queryRunner.dropTable('traffic_hourly', true);
    await queryRunner.dropTable('traffic_event', true);
  }
}
