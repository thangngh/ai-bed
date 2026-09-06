import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../now-default-expr';

export class CreateLocalTables1756166400003 implements MigrationInterface {
  name = 'CreateLocalTables1756166400003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = NOW_UTC_TEXT_EXPR;

    await queryRunner.createTable(
      new Table({
        name: 'stories',
        columns: [
          { name: 'story_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          { name: 'child_id', type: 'text', isNullable: true },
          { name: 'request_id', type: 'text', isNullable: true },
          { name: 'title', type: 'text' },
          { name: 'content', type: 'text' },
          { name: 'structure_json', type: 'text', isNullable: true },
          { name: 'theme', type: 'text' },
          { name: 'goal', type: 'text', isNullable: true },
          { name: 'mood', type: 'text', isNullable: true },
          { name: 'language', type: 'text', default: `'vi'` },
          { name: 'safety_status', type: 'text', default: `'PENDING'` },
          { name: 'llm_calls', type: 'integer', default: 0 },
          { name: 'retry_count', type: 'integer', default: 0 },
          { name: 'total_latency_ms', type: 'integer', isNullable: true },
          { name: 'word_count', type: 'integer', isNullable: true },
          { name: 'is_fallback', type: 'integer', default: 0 },
          { name: 'is_saved', type: 'integer', default: 0 },
          { name: 'created_at', type: 'text', default: now },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'story_sections',
        columns: [
          { name: 'section_id', type: 'text', isPrimary: true },
          { name: 'story_id', type: 'text' },
          { name: 'tenant_id', type: 'text' },
          { name: 'section_type', type: 'text' },
          { name: 'content', type: 'text' },
          { name: 'order_index', type: 'integer' },
          { name: 'interaction_prompt', type: 'text', isNullable: true },
          { name: 'interaction_options', type: 'text', isNullable: true },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'story_sections',
      new TableForeignKey({
        columnNames: ['story_id'],
        referencedTableName: 'stories',
        referencedColumnNames: ['story_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'memory_items',
        columns: [
          { name: 'memory_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          { name: 'child_id', type: 'text', isNullable: true },
          { name: 'story_id', type: 'text', isNullable: true },
          { name: 'memory_type', type: 'text' },
          { name: 'memory_key', type: 'text' },
          { name: 'memory_value', type: 'text' },
          { name: 'confidence', type: 'real', default: 0.5 },
          { name: 'source_text', type: 'text', isNullable: true },
          { name: 'source', type: 'text', isNullable: true },
          { name: 'last_reinforced_at', type: 'text', isNullable: true },
          { name: 'is_active', type: 'integer', default: 1 },
          { name: 'expires_at', type: 'text', isNullable: true },
          { name: 'created_at', type: 'text', default: now },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('memory_items', true);
    await queryRunner.dropTable('story_sections', true);
    await queryRunner.dropTable('stories', true);
  }
}
