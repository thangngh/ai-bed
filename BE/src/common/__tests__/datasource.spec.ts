import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { StoryService } from '../../modules/story/story.service';
import { MemoryService } from '../../modules/memory/memory.service';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { EngineGatewayService } from '../../modules/engine-gateway/engine-gateway.service';
import { CORE_TOKEN, openTestDataSource, closeTestDataSource } from './test-db';

// Compiling the real AppModule with ONLY the core datasource provided is the
// regression test for the collapse: any module still asking for a 'local'
// connection fails here, because nothing provides that token any more.
describe('single core datasource', () => {
  let module: TestingModule;
  let core: DataSource;

  beforeAll(async () => {
    core = await openTestDataSource();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CORE_TOKEN)
      .useValue(core)
      .overrideProvider(EngineGatewayService)
      .useValue({ generate: jest.fn() })
      .compile();
  });

  afterAll(async () => {
    await closeTestDataSource(core);
  });

  it('initializes the core datasource', () => {
    expect(module.get<DataSource>(CORE_TOKEN).isInitialized).toBe(true);
  });

  it('resolves every service that used to sit on the local datasource', () => {
    expect(module.get(StoryService)).toBeDefined();
    expect(module.get(MemoryService)).toBeDefined();
    expect(module.get(AnalyticsService)).toBeDefined();
  });

  it('registers the former local entities on the core connection', () => {
    const tables = module
      .get<DataSource>(CORE_TOKEN)
      .entityMetadatas.map((m) => m.tableName);

    expect(tables).toContain('stories');
    expect(tables).toContain('story_sections');
    expect(tables).toContain('memory_items');
  });
});
