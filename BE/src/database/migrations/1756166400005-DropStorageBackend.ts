import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * `storage_backend` and `migrated_at` were added to drive a per-tenant
 * SQLite -> Postgres dual-write cutover. That cutover was dropped: the only
 * SQLite data was throwaway dev data, so there was nothing to protect. No
 * application code ever read either column.
 */
export class DropStorageBackend1756166400005 implements MigrationInterface {
  name = 'DropStorageBackend1756166400005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tenants', 'storage_backend');
    await queryRunner.dropColumn('tenants', 'migrated_at');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tenants',
      new TableColumn({ name: 'storage_backend', type: 'text', default: `'sqlite'` }),
    );
    await queryRunner.addColumn(
      'tenants',
      new TableColumn({ name: 'migrated_at', type: 'text', isNullable: true }),
    );
  }
}
