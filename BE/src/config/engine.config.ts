import { registerAs } from '@nestjs/config';

export default registerAs('engine', () => ({
  baseUrl: process.env.ENGINE_URL || 'http://localhost:8000',
  timeoutMs: parseInt(process.env.ENGINE_TIMEOUT_MS || '25000', 10),
  retryCount: parseInt(process.env.ENGINE_RETRY_COUNT || '2', 10),
  retryDelayMs: 1000,
}));
