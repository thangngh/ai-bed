import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { EngineGatewayService } from '../../engine-gateway/engine-gateway.service';
import { ValidationPipe } from '../../../common/pipes/validation.pipe';
import { Tenant } from '../../tenant/entities/tenant.entity';
import { ChildProfile } from '../../child/entities/child-profile.entity';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { Story } from '../../story/entities/story.entity';
import { StorySection } from '../../story/entities/story-section.entity';
import { MemoryItem } from '../../memory/entities/memory-item.entity';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('Story Module (integration)', () => {
  let app: INestApplication;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken('core'))
      .useFactory({
        factory: async () => {
          const ds = new DataSource({
            type: 'sqlite',
            database: ':memory:',
            entities: [Tenant, ChildProfile, Feedback],
            synchronize: true,
          });
          await ds.initialize();
          return ds;
        },
      })
      .overrideProvider(getDataSourceToken('local'))
      .useFactory({
        factory: async () => {
          const ds = new DataSource({
            type: 'sqlite',
            database: ':memory:',
            entities: [Story, StorySection, MemoryItem],
            synchronize: true,
          });
          await ds.initialize();
          return ds;
        },
      })
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
    await module.get(getDataSourceToken('core')).destroy();
    await module.get(getDataSourceToken('local')).destroy();
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
    await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', 'not-a-uuid')
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(400);
  });

  it('POST /story/create with invalid age returns 400 VALIDATION_ERROR', async () => {
    await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', VALID_TENANT)
      .send({ child_name: 'An', age: 10, theme: 'Động vật' })
      .expect(400);
  });
});
