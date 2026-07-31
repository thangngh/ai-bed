import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import {
  CORE_TOKEN,
  LOCAL_TOKEN,
  openTestDataSources,
  closeTestDataSources,
} from './test-db';
import { DataSource } from 'typeorm';

describe('DualDataSource', () => {
  let module: TestingModule;

  beforeAll(async () => {
    const ds = await openTestDataSources();
    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CORE_TOKEN)
      .useValue(ds.core)
      .overrideProvider(LOCAL_TOKEN)
      .useValue(ds.local)
      .compile();
  });

  it('should have core datasource', () => {
    const ds: DataSource = module.get(CORE_TOKEN);
    expect(ds).toBeDefined();
    expect(ds.isInitialized).toBe(true);
  });

  it('should have local datasource', () => {
    const ds: DataSource = module.get(LOCAL_TOKEN);
    expect(ds).toBeDefined();
    expect(ds.isInitialized).toBe(true);
  });

  afterAll(async () => {
    await closeTestDataSources(module.get(CORE_TOKEN), module.get(LOCAL_TOKEN));
  });
});
