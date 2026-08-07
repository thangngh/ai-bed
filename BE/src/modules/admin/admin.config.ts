import { registerAs } from '@nestjs/config';

export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_TTL_SECONDS = 28800; // 8 hours

export interface AdminConfig {
  secret: string;
  ttlSeconds: number;
}

export function readAdminConfig(env: NodeJS.ProcessEnv): AdminConfig {
  const secret = env.ADMIN_JWT_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    // Never interpolate the value being rejected -- the message ends up in
    // logs and crash reports.
    throw new Error(
      `ADMIN_JWT_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters. ` +
        `Generate one with: node -e console.log(require('crypto').randomBytes(48).toString('base64url'))`,
    );
  }

  const raw = env.ADMIN_JWT_TTL_SECONDS;
  const ttlSeconds = raw === undefined || raw === '' ? DEFAULT_TTL_SECONDS : Number(raw);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('ADMIN_JWT_TTL_SECONDS must be a positive whole number of seconds');
  }

  return { secret, ttlSeconds };
}

export default registerAs('admin', (): AdminConfig => readAdminConfig(process.env));
