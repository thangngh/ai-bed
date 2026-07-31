import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import {
  CORE_TOKEN,
  LOCAL_TOKEN,
  openTestDataSources,
  closeTestDataSources,
} from '../../../common/__tests__/test-db';

// Only runs when E2E=1 (Engine must be running on ENGINE_URL)
const describeE2E = process.env.E2E === '1' ? describe : describe.skip;

describeE2E('Story flow with real Engine', () => {
  let app: INestApplication;
  let module: TestingModule;
  let core: any;
  let local: any;

  async function buildApp(engineUrl: string) {
    process.env.ENGINE_URL = engineUrl;
    const ds = await openTestDataSources();
    core = ds.core;
    local = ds.local;
    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CORE_TOKEN)
      .useValue(core)
      .overrideProvider(LOCAL_TOKEN)
      .useValue(local)
      .compile();
    app = module.createNestApplication();
    await app.init();
  }

  beforeAll(async () => {
    await buildApp(process.env.ENGINE_URL || 'http://localhost:8001');
  });

  afterAll(async () => {
    await closeTestDataSources(core, local);
  });

  it('POST /story/create returns 201 with story from real Engine', async () => {
    const init = await request(app.getHttpServer()).post('/tenant/init').expect(201);
    const tenantId = init.body.tenant_id;

    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenantId)
      .send({ child_name: 'An', age: 4, theme: 'Động vật', goal: 'Dũng cảm', mood: 'vui vẻ' })
      .expect(201);

    expect(res.body.story_id).toBeDefined();
    expect(res.body.title).toBeTruthy();
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.word_count).toBeGreaterThan(0);
  }, 60000);

  it('GET /story/:id returns saved story for the tenant', async () => {
    const init = await request(app.getHttpServer()).post('/tenant/init').expect(201);
    const tenantId = init.body.tenant_id;

    const created = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenantId)
      .send({ child_name: 'Bình', age: 5, theme: 'Khủng long' })
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/story/${created.body.story_id}`)
      .set('X-Tenant-Id', tenantId)
      .expect(200);
    expect(detail.body.title).toBe(created.body.title);
  }, 60000);

  it('keeps stories isolated between tenants', async () => {
    const t1 = (await request(app.getHttpServer()).post('/tenant/init').expect(201)).body.tenant_id;
    const t2 = (await request(app.getHttpServer()).post('/tenant/init').expect(201)).body.tenant_id;

    await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', t1)
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(201);

    const other = await request(app.getHttpServer())
      .get('/story/latest')
      .set('X-Tenant-Id', t2)
      .expect(200);
    expect(other.body.stories).toHaveLength(0);
  }, 60000);

  it('returns 502 ENGINE_UNAVAILABLE when Engine is down', async () => {
    await closeTestDataSources(core, local);

    const saveUrl = process.env.ENGINE_URL;
    await buildApp('http://localhost:65534');

    const init = await request(app.getHttpServer()).post('/tenant/init').expect(201);
    const tenantId = init.body.tenant_id;

    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenantId)
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(502);
    expect(res.body.error.code).toBe('ENGINE_UNAVAILABLE');

    process.env.ENGINE_URL = saveUrl;
  }, 30000);
});
