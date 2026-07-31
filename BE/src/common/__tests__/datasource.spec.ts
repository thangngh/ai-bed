import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../../modules/child/entities/child-profile.entity';
import { Feedback } from '../../modules/feedback/entities/feedback.entity';
import { Story } from '../../modules/story/entities/story.entity';
import { StorySection } from '../../modules/story/entities/story-section.entity';
import { MemoryItem } from '../../modules/memory/entities/memory-item.entity';

function makeDataSource(entities: any[]): DataSource {
  return new DataSource({
    type: 'sqlite' as const,
    database: ':memory:',
    entities,
    synchronize: true,
  });
}

describe('DualDataSource', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken('core'))
      .useFactory({
        factory: async () => {
          const ds = makeDataSource([Tenant, ChildProfile, Feedback]);
          await ds.initialize();
          return ds;
        },
      })
      .overrideProvider(getDataSourceToken('local'))
      .useFactory({
        factory: async () => {
          const ds = makeDataSource([Story, StorySection, MemoryItem]);
          await ds.initialize();
          return ds;
        },
      })
      .compile();
  });

  it('should have core datasource', async () => {
    const ds = module.get(getDataSourceToken('core'));
    expect(ds).toBeDefined();
    expect(ds.isInitialized).toBe(true);
  });

  it('should have local datasource', async () => {
    const ds = module.get(getDataSourceToken('local'));
    expect(ds).toBeDefined();
    expect(ds.isInitialized).toBe(true);
  });

  afterAll(async () => {
    await module.get(getDataSourceToken('core')).destroy();
    await module.get(getDataSourceToken('local')).destroy();
  });
});
