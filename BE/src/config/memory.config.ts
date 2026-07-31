import { registerAs } from '@nestjs/config';

export default registerAs('memory', () => ({
  ttlDays: parseInt(process.env.MEMORY_TTL_DAYS || '90', 10),
  confidenceBoost: parseFloat(process.env.MEMORY_CONFIDENCE_BOOST || '0.1'),
  extractEnabled: process.env.MEMORY_EXTRACT_ENABLED !== 'false',
}));
