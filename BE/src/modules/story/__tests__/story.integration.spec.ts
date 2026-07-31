import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../../app.module';

describe('Story Module (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('POST /story/create without X-Tenant-Id returns 401', async () => {
    await request(app.getHttpServer())
      .post('/story/create')
      .send({ child_name: 'Test', age: 4, theme: 'Động vật' })
      .expect(401);
  });

  it('POST /story/create with valid tenant returns 201', async () => {
    await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', 'test-integration-uuid')
      .send({ child_name: 'Test', age: 4, theme: 'Động vật' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });
});