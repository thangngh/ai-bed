import { registerAs } from '@nestjs/config';

export default registerAs('engine', () => ({
  baseUrl: process.env.ENGINE_URL || 'http://localhost:8000',
  // Above the Engine's own 45s pipeline budget, so a slow generation degrades
  // to a fallback story instead of surfacing here as a 502.
  timeoutMs: parseInt(process.env.ENGINE_TIMEOUT_MS || '60000', 10),
  retryCount: parseInt(process.env.ENGINE_RETRY_COUNT || '2', 10),
  retryDelayMs: 1000,
}));
