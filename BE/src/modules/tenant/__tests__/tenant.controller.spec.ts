import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Module, Global } from '@nestjs/common';
import { TenantModule } from '../tenant.module';
import { CORE_TOKEN, makeDataSource } from '../../../common/__tests__/test-db';
import { DataSource } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';

@Global()
@Module({
  providers: [
    {
      provide: CORE_TOKEN,
      useFactory: async () => {
        const ds = makeDataSource([Tenant]);
        await ds.initialize();
        return ds;
      },
    },
  ],
  exports: [CORE_TOKEN],
})
class TestCoreDataSourceModule {}

describe('TenantController', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TenantModule, TestCoreDataSourceModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    dataSource = module.get(CORE_TOKEN);
  });

  afterAll(async () => {
    await app.close();
    await dataSource.destroy();
  });

  it('POST /tenant/init should return a tenant_id', async () => {
    const res = await request(app.getHttpServer())
      .post('/tenant/init')
      .expect(201);

    expect(res.body.tenant_id).toBeDefined();
    expect(res.body.tenant_id.length).toBe(36);
    expect(res.body.message).toBe('Tenant initialized');
  });
});
