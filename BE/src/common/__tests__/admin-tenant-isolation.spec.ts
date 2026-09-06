import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { EngineGatewayService } from '../../modules/engine-gateway/engine-gateway.service';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import {
  CORE_TOKEN,
  openTestDataSource,
  closeTestDataSource,
} from './test-db';

jest.setTimeout(60_000);

// Boots the real AppModule -- unlike a copy of AppModule.configure(), this
// means a change to the real exclusion pattern in app.module.ts fails this
// test, not just the spy test below.
describe('/admin never mints a tenant', () => {
  let app: INestApplication;
  let module: TestingModule;
  let core: DataSource;

  beforeAll(async () => {
    core = await openTestDataSource();

    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CORE_TOKEN)
      .useValue(core)
      .overrideProvider(EngineGatewayService)
      .useValue({ generate: jest.fn() })
      .compile();

    app = module.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    // Manual close() — app.close()/module.close() throw for named
    // `forRootAsync` datasources.
    await closeTestDataSource(core);
  });

  it('leaves the tenants table untouched across admin requests', async () => {
    const repo = core.getRepository(Tenant);
    const before = await repo.count();

    await request(app.getHttpServer()).get('/admin/feedbacks').expect(401);
    await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'nobody', password: 'nothing-at-all' });

    expect(await repo.count()).toBe(before);
  });

  it('proves the harness would otherwise create one', async () => {
    // A non-admin route with no X-Tenant-Id header still auto-creates, so the
    // assertion above is about the exclusion and not about a dead middleware.
    const repo = core.getRepository(Tenant);
    const before = await repo.count();
    await request(app.getHttpServer()).post('/tenant/init').expect(201);
    expect(await repo.count()).toBeGreaterThan(before);
  });
});

describe('AppModule middleware configuration', () => {
  it('excludes admin routes from the tenant middleware', () => {
    const calls: { method: string; args: any[] }[] = [];
    const chain: any = {
      apply: (...args: any[]) => { calls.push({ method: 'apply', args }); return chain; },
      exclude: (...args: any[]) => { calls.push({ method: 'exclude', args }); return chain; },
      forRoutes: (...args: any[]) => { calls.push({ method: 'forRoutes', args }); return chain; },
    };
    const consumer: any = { apply: chain.apply };

    new AppModule().configure(consumer);

    const exclude = calls.find((c) => c.method === 'exclude');
    expect(exclude).toBeDefined();
    // Regressing this line lets the tenant middleware mint a tenant for every admin request.
    expect(exclude!.args).toContain('admin/(.*)');
    expect(exclude!.args).toContain('health');
  });
});
