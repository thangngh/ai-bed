import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { ChildProfile } from '../entities/child-profile.entity';
import { EngineGatewayService } from '../../engine-gateway/engine-gateway.service';
import { ValidationPipe } from '../../../common/pipes/validation.pipe';
import {
  CORE_TOKEN,
  LOCAL_TOKEN,
  openTestDataSources,
  closeTestDataSources,
} from '../../../common/__tests__/test-db';

// Each test uses a fresh tenant so the token-bucket rate limiter (per-tenant)
// never exhausts its default 10-request bucket across the whole suite.
let tenantSeq = 0;
function freshTenant(): string {
  tenantSeq += 1;
  const n = tenantSeq.toString().padStart(12, '0');
  return `12345678-1234-4123-8123-${n.slice(0, 12)}`;
}

describe('Child Profile Module (integration)', () => {
  let app: INestApplication;
  let module: TestingModule;
  let core: DataSource;
  let local: DataSource;

  beforeAll(async () => {
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
      .overrideProvider(EngineGatewayService)
      .useValue({
        generate: jest.fn().mockResolvedValue({
          requestId: 'req-1',
          title: 'Chú thỏ dũng cảm',
          content: [],
          safetyStatus: 'APPROVED',
          memories: [],
          llmCalls: 1,
          retryCount: 0,
          latencyMs: 5,
          wordCount: 10,
          isFallback: false,
        }),
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    // Manual destroy() — see story.integration.spec.ts for the reason.
    await closeTestDataSources(core, local);
  });

  it('POST /child-profile creates a child and returns child_id', async () => {
    const res = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', freshTenant())
      .send({ child_name: 'An', age: 4, gender: 'girl' })
      .expect(201);

    expect(res.body.child_id).toBeDefined();
    expect(res.body.child_name).toBe('An');
    expect(res.body.age).toBe(4);
  });

  it('POST /child-profile persists gender', async () => {
    const tenant = freshTenant();
    const res = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Binh', age: 5, gender: 'boy' })
      .expect(201);

    const saved = await core.getRepository(ChildProfile).findOneBy({ childId: res.body.child_id });
    expect(saved?.gender).toBe('boy');
  });

  it('POST /child-profile duplicate name returns 409', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Chi', age: 4 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Chi', age: 5 })
      .expect(409);
  });

  it('GET /child-profile lists all children for the tenant', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Duc', age: 4 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Minh', age: 6 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .expect(200);

    expect(res.body.children.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /child-profile?child_name=X finds by name', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Minh', age: 6 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .query({ child_name: 'Minh' })
      .expect(200);

    expect(res.body.child_name).toBe('Minh');
    expect(res.body.child_id).toBeDefined();
  });

  it('GET /child-profile?child_name=X returns null child_id when not found', async () => {
    const res = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', freshTenant())
      .query({ child_name: 'NotFound' })
      .expect(200);

    expect(res.body.child_id).toBeNull();
  });

  it('PUT /child-profile/:childId updates child fields', async () => {
    const tenant = freshTenant();
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Lan', age: 3 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .put(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ age: 5, gender: 'girl', bedtime_goal: 'Ngủ đúng giờ' })
      .expect(200);

    expect(res.body.child_id).toBe(created.body.child_id);

    const saved = await core.getRepository(ChildProfile).findOneBy({ childId: created.body.child_id });
    expect(saved?.age).toBe(5);
    expect(saved?.gender).toBe('girl');
    expect(saved?.bedtimeGoal).toBe('Ngủ đúng giờ');
  });

  it('DELETE /child-profile/:childId soft-deletes (204, excluded from GET)', async () => {
    const tenant = freshTenant();
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'ToDelete', age: 5 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .expect(200);
    expect(list.body.children.find((c: any) => c.child_id === created.body.child_id)).toBeUndefined();

    const byName = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .query({ child_name: 'ToDelete' })
      .expect(200);
    expect(byName.body.child_id).toBeNull();
  });

  it('DELETE /child-profile/:childId returns 404 for unknown child', async () => {
    await request(app.getHttpServer())
      .delete('/child-profile/nonexistent-id')
      .set('X-Tenant-Id', freshTenant())
      .expect(404);
  });

  it('keeps child profiles isolated between tenants', async () => {
    const writer = freshTenant();
    const reader = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', writer)
      .send({ child_name: 'Solo', age: 4 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', reader)
      .query({ child_name: 'Solo' })
      .expect(200);
    expect(res.body.child_id).toBeNull();
  });

  it('POST /child-profile with invalid age returns 422 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', freshTenant())
      .send({ child_name: 'Qua', age: 10 })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /child-profile with invalid tenant returns 400 INVALID_TENANT', async () => {
    const res = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', 'not-a-uuid')
      .send({ child_name: 'An', age: 4 })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_TENANT');
  });

  it('POST then GET returns every profile field', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({
        child_name: 'Đủ',
        age: 5,
        gender: 'girl',
        interests: 'khủng long',
        preferred_characters: 'Thỏ Bông',
        bedtime_goal: 'Chia sẻ',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .query({ child_name: 'Đủ' })
      .expect(200);

    expect(res.body).toMatchObject({
      child_name: 'Đủ',
      age: 5,
      gender: 'girl',
      interests: 'khủng long',
      preferred_characters: 'Thỏ Bông',
      bedtime_goal: 'Chia sẻ',
    });
    expect(res.body.child_id).toBeDefined();
  });

  it('PUT with only age leaves the other profile fields untouched', async () => {
    // The bug this guards: GET used to omit these fields, so the editor
    // prefilled them empty and sent the blanks back. StoryService reads
    // preferredCharacters and bedtimeGoal to build the prompt, so editing an
    // age used to silently change what every later story was written from.
    const tenant = freshTenant();
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({
        child_name: 'GiuNguyen',
        age: 4,
        interests: 'tàu hỏa',
        preferred_characters: 'Gấu Pooh',
        bedtime_goal: 'Dũng cảm',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .put(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ age: 6 })
      .expect(200);

    expect(res.body.age).toBe(6);
    expect(res.body.interests).toBe('tàu hỏa');
    expect(res.body.preferred_characters).toBe('Gấu Pooh');
    expect(res.body.bedtime_goal).toBe('Dũng cảm');

    const saved = await core.getRepository(ChildProfile).findOneBy({ childId: created.body.child_id });
    expect(saved?.interests).toBe('tàu hỏa');
    expect(saved?.preferredCharacters).toBe('Gấu Pooh');
    expect(saved?.bedtimeGoal).toBe('Dũng cảm');
  });

  it('GET list returns every profile field', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Danh', age: 3, interests: 'công chúa' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .expect(200);

    const found = res.body.children.find((c: any) => c.child_name === 'Danh');
    expect(found.interests).toBe('công chúa');
    expect(found.bedtime_goal).toBeNull();
  });

  it('PUT /child-profile/:childId returns 404 for a deleted child', async () => {
    const tenant = freshTenant();
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'DaXoa', age: 4 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .expect(204);

    await request(app.getHttpServer())
      .put(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ age: 5 })
      .expect(404);
  });

  it('PUT /child-profile/:childId renames a child', async () => {
    const tenant = freshTenant();
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Cu', age: 4 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .put(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Moi' })
      .expect(200);

    expect(res.body.child_name).toBe('Moi');
  });

  it('PUT /child-profile/:childId returns 409 when the new name is taken', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'DaCo', age: 4 })
      .expect(201);
    const mover = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'SeDoi', age: 4 })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/child-profile/${mover.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'DaCo' })
      .expect(409);
  });
});
