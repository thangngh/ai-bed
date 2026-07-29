import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AppModule } from '../../app.module';

describe('DualDataSource', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    await module.close();
  });
});
