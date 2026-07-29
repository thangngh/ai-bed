import { registerAs } from '@nestjs/config';

export default registerAs('rateLimit', () => ({
  capacity: parseInt(process.env.RATE_LIMIT_CAPACITY || '10', 10),
  refillRate: parseInt(process.env.RATE_LIMIT_REFILL_SECONDS || '6', 10),
}));
