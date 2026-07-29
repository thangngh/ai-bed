import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { TenantModule } from '../tenant.module';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';

describe('TenantController', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TenantModule],
    })
      .overrideProvider(getDataSourceToken('core'))
      .useFactory({
        factory: async () => {
          const ds = new DataSource({
            type: 'sqlite',
            database: ':memory:',
            entities: [Tenant],
            synchronize: true,
          });
          await ds.initialize();
          return ds;
        },
      })
      .compile();

    app = module.createNestApplication();
    await app.init();
    dataSource = module.get(getDataSourceToken('core'));
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
