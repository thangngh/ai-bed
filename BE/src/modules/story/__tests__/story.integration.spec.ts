import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { EngineGatewayService } from '../../engine-gateway/engine-gateway.service';
import { ValidationPipe } from '../../../common/pipes/validation.pipe';
import {
  CORE_TOKEN,
  LOCAL_TOKEN,
  openTestDataSources,
  closeTestDataSources,
} from '../../../common/__tests__/test-db';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('Story Module (integration)', () => {
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
          content: [
            { type: 'opening', text: 'Ngày xửa ngày xưa...', order: 1 },
            { type: 'interaction', text: 'Bé nghĩ sao?', order: 2 },
          ],
          safetyStatus: 'APPROVED',
          memories: [],
          llmCalls: 3,
          retryCount: 0,
          latencyMs: 50,
          wordCount: 120,
          isFallback: false,
        }),
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    // Manual destroy() is required because app.close()/module.close() throw for
    // named `forRootAsync` datasources: @nestjs/typeorm drops the `name` field
    // from the resolved options, so the shutdown hook looks up the wrong token.
    // If that framework shutdown bug is fixed, remove the manual destroy.
    await closeTestDataSources(core, local);
  });

  it('POST /story/create without X-Tenant-Id auto-creates tenant and returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(201);
    expect(res.headers['x-tenant-id']).toBeDefined();
    expect(res.body.title).toBe('Chú thỏ dũng cảm');
  });

  it('POST /story/create with valid tenant returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', VALID_TENANT)
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(201);
    expect(res.body.story_id).toBeDefined();
    expect(res.body.safety_status).toBe('APPROVED');
  });

  it('POST /story/create with invalid tenant returns 400 INVALID_TENANT', async () => {
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', 'not-a-uuid')
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_TENANT');
  });

  it('POST /story/create with invalid age returns 422 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', VALID_TENANT)
      .send({ child_name: 'An', age: 10, theme: 'Động vật' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
