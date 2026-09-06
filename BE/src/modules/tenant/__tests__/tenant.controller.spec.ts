import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Module, Global } from '@nestjs/common';
import { TenantModule } from '../tenant.module';
import { CORE_TOKEN, openTestDataSource, closeTestDataSource } from '../../../common/__tests__/test-db';
import { DataSource } from 'typeorm';

@Global()
@Module({
  providers: [{ provide: CORE_TOKEN, useValue: null }],
  exports: [CORE_TOKEN],
})
class TestCoreDataSourceModule {}

describe('TenantController', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    // Hoisted (rather than a useFactory on the provider) so afterAll has a
    // handle to close it via closeTestDataSource.
    dataSource = await openTestDataSource();

    const module = await Test.createTestingModule({
      imports: [TenantModule, TestCoreDataSourceModule],
    })
      .overrideProvider(CORE_TOKEN)
      .useValue(dataSource)
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDataSource(dataSource);
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
