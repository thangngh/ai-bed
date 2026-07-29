import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  coreDbPath: process.env.CORE_DB_PATH || 'data/core.db',
  localDbPath: process.env.LOCAL_DB_PATH || 'data/local.db',
}));
