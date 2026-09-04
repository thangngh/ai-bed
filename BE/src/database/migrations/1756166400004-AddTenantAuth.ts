import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../now-default-expr';

/**
 * Turns `tenants` into a real parent account.
 *
 * The table already carried `auth_type` / `auth_key` from the MVP schema but
 * nothing ever wrote them: every tenant was `local` with a null key. Google
 * sign-in fills them in (`google` + the Google `sub`), so the pair needs a
 * uniqueness guarantee, and refresh tokens need somewhere to live.
 */
export class AddTenantAuth1756166400004 implements MigrationInterface {
  name = 'AddTenantAuth1756166400004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = NOW_UTC_TEXT_EXPR;

    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN "email" text`);

    // Partial, so the many pre-existing anonymous tenants -- all of which have
    // a null auth_key -- do not collide with each other.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_tenants_auth_provider_key" ON "tenants" ("auth_type", "auth_key") WHERE "auth_key" IS NOT NULL`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'tenant_sessions',
        columns: [
          { name: 'session_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          // Only the SHA-256 of the refresh token is stored: a dump of this
          // table must not be replayable against the API.
          { name: 'token_hash', type: 'text', isUnique: true },
          { name: 'expires_at', type: 'text' },
          { name: 'revoked_at', type: 'text', isNullable: true },
          { name: 'created_ip', type: 'text', isNullable: true },
          { name: 'created_at', type: 'text', default: now },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'tenant_sessions',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedTableName: 'tenants',
        referencedColumnNames: ['tenant_id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.query(
      `CREATE INDEX "idx_tenant_sessions_tenant" ON "tenant_sessions" ("tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tenant_sessions_tenant"`);
    await queryRunner.dropTable('tenant_sessions', true);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tenants_auth_provider_key"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "email"`);
  }
}
