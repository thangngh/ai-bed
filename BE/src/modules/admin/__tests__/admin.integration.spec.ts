import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { AdminUser } from '../entities/admin-user.entity';
import { hashPassword } from '../auth/password';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { Tenant } from '../../tenant/entities/tenant.entity';
import { EngineGatewayService } from '../../engine-gateway/engine-gateway.service';
import { HttpExceptionFilter } from '../../../common/filters/http-exception.filter';
import { ValidationPipe } from '../../../common/pipes/validation.pipe';
import {
  CORE_TOKEN,
  openTestDataSource,
  closeTestDataSource,
} from '../../../common/__tests__/test-db';

jest.setTimeout(60_000);

describe('Admin API', () => {
  let app: INestApplication;
  let module: TestingModule;
  let core: DataSource;

  beforeAll(async () => {
    core = await openTestDataSource();

    await core.getRepository(AdminUser).save(Object.assign(new AdminUser(), {
      adminId: 'admin-1',
      username: 'thang',
      passwordHash: await hashPassword('integration-password-1'),
    }));
    // feedbacks.tenant_id is a real foreign key under Postgres, so the parent
    // tenant row must exist before the feedback referencing it does.
    await core.getRepository(Tenant).save(Object.assign(new Tenant(), { tenantId: 't1' }));
    await core.getRepository(Feedback).save(Object.assign(new Feedback(), {
      feedbackId: 'f1', tenantId: 't1', storyId: 's1', rating: 5, note: 'tuyệt',
      createdAt: '2026-08-01 08:00:00',
    }));

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
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    // Manual close() — app.close()/module.close() throw for named
    // `forRootAsync` datasources.
    await closeTestDataSource(core);
  });

  async function login(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'thang', password: 'integration-password-1' })
      .expect(201);
    return res.body.token;
  }

  it('returns a bare token object, not a { data } envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'thang', password: 'integration-password-1' })
      .expect(201);

    expect(res.body).not.toHaveProperty('data');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.admin).toEqual({ admin_id: 'admin-1', username: 'thang' });
  });

  it('rejects the wrong password with INVALID_CREDENTIALS', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'thang', password: 'definitely-wrong-1' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('never returns the submitted password in a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'thang', password: '' })
      .expect(422);
    expect(JSON.stringify(res.body)).not.toContain('"value"');
  });

  it('refuses GET /admin/feedbacks without a token', async () => {
    const res = await request(app.getHttpServer()).get('/admin/feedbacks').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('serves the feedback page with a token', async () => {
    const token = await login();
    const res = await request(app.getHttpServer())
      .get('/admin/feedbacks?limit=10')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).not.toHaveProperty('data');
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.items[0].feedback_id).toBe('f1');
  });

  it('rejects a malformed query with VALIDATION_ERROR', async () => {
    const token = await login();
    const res = await request(app.getHttpServer())
      .get('/admin/feedbacks?rating=99')
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
