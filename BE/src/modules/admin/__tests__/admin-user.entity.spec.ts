import { AdminUser } from '../entities/admin-user.entity';
import { openTestDataSource, closeTestDataSource } from '../../../common/__tests__/test-db';

describe('AdminUser entity', () => {
  it('creates an admin_users table with a unique username', async () => {
    const ds = await openTestDataSource();
    const repo = ds.getRepository(AdminUser);

    await repo.save(Object.assign(new AdminUser(), {
      adminId: 'a1', username: 'thang', passwordHash: 'scrypt$...',
    }));

    const found = await repo.findOne({ where: { username: 'thang' } });
    expect(found?.adminId).toBe('a1');
    expect(found?.createdAt).toBeTruthy();
    expect(found?.lastLoginAt ?? null).toBeNull();

    await expect(
      repo.insert(Object.assign(new AdminUser(), {
        adminId: 'a2', username: 'thang', passwordHash: 'scrypt$...',
      })),
    ).rejects.toThrow();

    await closeTestDataSource(ds);
  });
});
