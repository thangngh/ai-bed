import { Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerateDto } from './dto/generate-story.dto';
import { EngineResponse } from './dto/engine-response.dto';

@Injectable()
export class EngineGatewayService {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(private config: ConfigService) {
    this.baseUrl = this.config.get('engine.baseUrl', 'http://localhost:8000');
    this.timeoutMs = this.config.get('engine.timeoutMs', 25000);
  }

  async generate(dto: GenerateDto): Promise<EngineResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': dto.tenantId },
        body: JSON.stringify(dto),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new HttpException(
          { error: { code: 'ENGINE_ERROR', message: err.error || 'Engine request failed' } },
          response.status,
        );
      }

      const data = await response.json();
      return {
        requestId: data.request_id || '',
        title: data.title,
        content: data.content,
        safetyStatus: data.safety_status || 'PENDING',
        memories: data.memories || [],
        llmCalls: data.llm_calls || 0,
        retryCount: 0,
        latencyMs: data.latency_ms || 0,
        wordCount: data.word_count || 0,
        isFallback: data.is_fallback || false,
      };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      if (err.name === 'AbortError') {
        throw new HttpException(
          { error: { code: 'ENGINE_TIMEOUT', message: 'Engine timeout after 15s' } },
          502,
        );
      }
      if (err.code === 'ECONNREFUSED') {
        throw new HttpException(
          { error: { code: 'ENGINE_UNAVAILABLE', message: 'Engine not available' } },
          502,
        );
      }
      throw new HttpException(
        { error: { code: 'ENGINE_ERROR', message: err.message } },
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
