import { Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// undici's own fetch, not the global one. A dispatcher built from this
// package is rejected by Node's built-in fetch ("invalid onRequestStart
// method") because the two are different copies of undici; pairing the Agent
// with the fetch from the same package is what makes it work.
import { Agent, fetch as undiciFetch, RequestInit as UndiciRequestInit } from 'undici';
import { GenerateDto } from './dto/generate-story.dto';
import { EngineResponse } from './dto/engine-response.dto';

/** The Engine's snake_case /generate response, before mapping to EngineResponse. */
interface EnginePayload {
  request_id?: string;
  title: string;
  content: unknown[];
  safety_status?: EngineResponse['safetyStatus'];
  memories?: unknown[];
  llm_calls?: number;
  latency_ms?: number;
  word_count?: number;
  is_fallback?: boolean;
}

@Injectable()
export class EngineGatewayService {
  private baseUrl: string;
  private timeoutMs: number;
  private apiKey: string;
  /**
   * Node's `fetch` applies undici's own 300s `headersTimeout` on top of our
   * AbortController, and it surfaces as a plain `TypeError`, not an
   * `AbortError`. That silently capped ENGINE_TIMEOUT_MS at 300s and made
   * genuine timeouts arrive as generic ENGINE_ERROR 502s -- measured as
   * failures at exactly 301.3s while the configured timeout was 420s.
   * Disabling both timeouts leaves the AbortController as the only deadline.
   */
  private dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

  constructor(private config: ConfigService) {
    this.baseUrl = this.config.get('engine.baseUrl', 'http://localhost:8000');
    this.timeoutMs = this.config.get('engine.timeoutMs', 25000);
    this.apiKey = this.config.get('engine.apiKey', '');
  }

  async generate(dto: GenerateDto): Promise<EngineResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await undiciFetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': dto.tenantId,
          ...(this.apiKey ? { 'X-Engine-Key': this.apiKey } : {}),
        },
        body: JSON.stringify(this.toEnginePayload(dto)),
        signal: controller.signal,
        dispatcher: this.dispatcher,
      } as UndiciRequestInit);

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new HttpException(
          { error: { code: 'ENGINE_ERROR', message: err.error || 'Engine request failed' } },
          response.status,
        );
      }

      // undici types `json()` as `unknown` rather than `any`, so the shape has
      // to be stated explicitly.
      const data = (await response.json()) as EnginePayload;
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
          {
            error: {
              code: 'ENGINE_TIMEOUT',
              message: `Engine timeout after ${Math.round(this.timeoutMs / 1000)}s`,
            },
          },
          502,
        );
      }
      if ((err.cause?.code === 'ECONNREFUSED') || (err.code === 'ECONNREFUSED')) {
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

  private toEnginePayload(dto: GenerateDto): Record<string, unknown> {
    return {
      child_name: dto.childName,
      age: dto.age,
      theme: dto.theme,
      goal: dto.goal ?? '',
      mood: dto.mood ?? 'vui vẻ',
      language: dto.language ?? 'vi',
      memories: dto.memories ?? [],
      recent_stories: dto.recentStories ?? [],
      gender: dto.gender ?? '',
      favorite_character: dto.favoriteCharacter ?? '',
    };
  }
}
