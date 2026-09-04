/**
 * Creates or resets an admin account.
 *
 *   ADMIN_PASSWORD='...' npm run admin:create -- --username thang
 *
 * The password comes from the environment rather than a --password flag so it
 * does not end up in shell history.
 */
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminUser } from '../src/modules/admin/entities/admin-user.entity';
import { hashPassword } from '../src/modules/admin/auth/password';
import 'dotenv/config';

const MIN_PASSWORD_LENGTH = 12;

function readUsername(argv: string[]): string {
  const index = argv.indexOf('--username');
  const raw = index >= 0 ? argv[index + 1] : undefined;
  if (!raw || raw.startsWith('--')) {
    throw new Error('Usage: npm run admin:create -- --username <name>   (password from $ADMIN_PASSWORD)');
  }
  const value = raw.trim();
  if (!value) {
    throw new Error('Usage: npm run admin:create -- --username <name>   (password from $ADMIN_PASSWORD)');
  }
  return value;
}

function readPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error('ADMIN_PASSWORD is not set. Set it in the environment, not as a --password flag.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

async function main(): Promise<void> {
  const username = readUsername(process.argv);
  const password = readPassword();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. See BE/.env.example.');
  }

  // No CREATE TABLE here any more: `admin_users` comes from
  // CreateCoreTables1756166400001, which the app runs on boot. If this script
  // fails with "relation admin_users does not exist", run `npm run
  // migration:run` first rather than re-adding a second schema source.
  const ds = new DataSource({ type: 'postgres', url, entities: [AdminUser] });
  await ds.initialize();

  const repo = ds.getRepository(AdminUser);
  const passwordHash = await hashPassword(password);
  const existing = await repo.findOne({ where: { username } });

  if (existing) {
    await repo.update({ adminId: existing.adminId }, { passwordHash });
    console.log(`Password reset for admin "${username}".`);
  } else {
    await repo.insert({ adminId: randomUUID(), username, passwordHash });
    console.log(`Admin "${username}" created.`);
  }

  await ds.destroy();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
