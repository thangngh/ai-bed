import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../now-default-expr';

export class CreateCoreTables1756166400001 implements MigrationInterface {
  name = 'CreateCoreTables1756166400001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = NOW_UTC_TEXT_EXPR;

    await queryRunner.createTable(
      new Table({
        name: 'tenants',
        columns: [
          { name: 'tenant_id', type: 'text', isPrimary: true },
          { name: 'name', type: 'text', default: `'anonymous'` },
          { name: 'auth_type', type: 'text', default: `'local'` },
          { name: 'auth_key', type: 'text', isNullable: true },
          { name: 'metadata', type: 'text', isNullable: true },
          { name: 'created_at', type: 'text', default: now },
          { name: 'updated_at', type: 'text', default: now },
          // Cutover control columns for the abandoned per-tenant dual-write
          // plan. Never read by application code; dropped again in
          // DropStorageBackend1756166400005. Kept here so the recorded
          // migration history stays replayable from scratch.
          { name: 'storage_backend', type: 'text', default: `'sqlite'` },
          { name: 'migrated_at', type: 'text', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'child_profiles',
        columns: [
          { name: 'child_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          { name: 'child_name', type: 'text' },
          { name: 'age', type: 'integer' },
          { name: 'interests', type: 'text', isNullable: true },
          { name: 'preferred_characters', type: 'text', isNullable: true },
          { name: 'bedtime_goal', type: 'text', isNullable: true },
          { name: 'gender', type: 'text', isNullable: true },
          { name: 'language', type: 'text', default: `'vi'` },
          { name: 'is_active', type: 'integer', default: 1 },
          { name: 'created_at', type: 'text', default: now },
          { name: 'updated_at', type: 'text', default: now },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'child_profiles',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedTableName: 'tenants',
        referencedColumnNames: ['tenant_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'feedbacks',
        columns: [
          { name: 'feedback_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          { name: 'story_id', type: 'text' },
          { name: 'child_id', type: 'text', isNullable: true },
          { name: 'listened_complete', type: 'integer', isNullable: true },
          { name: 'wants_more', type: 'integer', isNullable: true },
          { name: 'suitable', type: 'integer', isNullable: true },
          { name: 'rating', type: 'integer', isNullable: true },
          { name: 'note', type: 'text', isNullable: true },
          { name: 'created_at', type: 'text', default: now },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'feedbacks',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedTableName: 'tenants',
        referencedColumnNames: ['tenant_id'],
      }),
    );
    await queryRunner.createForeignKey(
      'feedbacks',
      new TableForeignKey({
        columnNames: ['child_id'],
        referencedTableName: 'child_profiles',
        referencedColumnNames: ['child_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'admin_users',
        columns: [
          { name: 'admin_id', type: 'text', isPrimary: true },
          { name: 'username', type: 'text', isUnique: true },
          { name: 'password_hash', type: 'text' },
          { name: 'created_at', type: 'text', default: now },
          { name: 'last_login_at', type: 'text', isNullable: true },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('admin_users', true);
    await queryRunner.dropTable('feedbacks', true);
    await queryRunner.dropTable('child_profiles', true);
    await queryRunner.dropTable('tenants', true);
  }
}
