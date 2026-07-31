import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { EngineGatewayService } from '../engine-gateway.service';
import { GenerateDto } from '../dto/generate-story.dto';

describe('EngineGatewayService contract', () => {
  let service: EngineGatewayService;
  let fetchMock: jest.Mock;

  const dto: GenerateDto = {
    childName: 'An',
    age: 4,
    theme: 'Động vật',
    goal: 'Dũng cảm',
    mood: 'vui vẻ',
    language: 'vi',
    memories: [{ type: 'interest', key: 'animal', value: 'mèo', confidence: 0.8 }],
    recentStories: [{ title: 'Cũ', theme: 'Khác' }],
    tenantId: '12345678-1234-4123-8123-123456789abc',
    gender: 'girl',
    favoriteCharacter: 'Mèo',
  };

  const engineResponse = {
    request_id: 'req-1',
    title: 'Chú thỏ',
    content: [{ type: 'opening', text: 'Xưa...', order: 1 }],
    safety_status: 'APPROVED',
    memories: [],
    llm_calls: 3,
    latency_ms: 120,
    word_count: 150,
    is_fallback: false,
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EngineGatewayService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: unknown) =>
              key === 'engine.baseUrl'
                ? 'http://engine:8000'
                : key === 'engine.timeoutMs'
                  ? 25000
                  : def,
          },
        },
      ],
    }).compile();
    service = moduleRef.get(EngineGatewayService);
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends snake_case payload to Engine', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => engineResponse });

    await service.generate(dto);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine:8000/generate');
    expect(init.headers['X-Tenant-Id']).toBe(dto.tenantId);
    const body = JSON.parse(init.body);
    expect(body.child_name).toBe('An');
    expect(body.recent_stories).toEqual([{ title: 'Cũ', theme: 'Khác' }]);
    expect(body.favorite_character).toBe('Mèo');
    expect(body.tenantId).toBeUndefined();
    expect(body.childName).toBeUndefined();
    expect(body.recentStories).toBeUndefined();
  });

  it('maps snake_case response to camelCase', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => engineResponse });

    const result = await service.generate(dto);

    expect(result.requestId).toBe('req-1');
    expect(result.safetyStatus).toBe('APPROVED');
    expect(result.llmCalls).toBe(3);
    expect(result.latencyMs).toBe(120);
    expect(result.wordCount).toBe(150);
    expect(result.isFallback).toBe(false);
  });

  it('throws ENGINE_ERROR with engine status on non-2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } }),
    });

    await expect(service.generate(dto)).rejects.toMatchObject({
      status: 422,
      response: { error: { code: 'ENGINE_ERROR' } },
    });
  });

  it('throws ENGINE_TIMEOUT on AbortError', async () => {
    const abortErr: any = new Error('aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValue(abortErr);

    await expect(service.generate(dto)).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'ENGINE_TIMEOUT' } },
    });
  });

  it('throws ENGINE_UNAVAILABLE on ECONNREFUSED', async () => {
    const netErr: any = new Error('connect ECONNREFUSED');
    netErr.code = 'ECONNREFUSED';
    fetchMock.mockRejectedValue(netErr);

    await expect(service.generate(dto)).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'ENGINE_UNAVAILABLE' } },
    });
  });
});
