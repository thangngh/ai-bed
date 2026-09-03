import { registerAs } from '@nestjs/config';

export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_ACCESS_TTL_SECONDS = 900; // 15 minutes
export const DEFAULT_REFRESH_TTL_DAYS = 30;

export interface ParentAuthDisabled {
  enabled: false;
}

export interface ParentAuthEnabled {
  enabled: true;
  googleClientId: string;
  googleClientSecret: string;
  googleCallbackUrl: string;
  /** Where the BE bounces the browser back to once a session exists. */
  frontendCallbackUrl: string;
  secret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  /**
   * `Path` on the refresh cookie, matched by the browser against the URL it
   * actually sends. The shipped setup puts the BE behind `/api/`, a direct
   * VITE_BE_URL deployment does not, so no single narrow value is correct for
   * both -- `/` is the one that works everywhere. Tighten it per deployment
   * (`/api/auth`) when the prefix is known.
   */
  refreshCookiePath: string;
}

export type ParentAuthConfig = ParentAuthDisabled | ParentAuthEnabled;

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return value;
}

function absoluteUrl(raw: string | undefined, name: string): string {
  if (!raw) {
    throw new Error(`${name} is required when GOOGLE_CLIENT_ID is set`);
  }
  try {
    new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  return raw;
}

/**
 * Google sign-in is opt-in: with no GOOGLE_CLIENT_ID the feature reports itself
 * disabled and the app boots exactly as it did before. Anything past that point
 * is treated as an intent to enable it, so a half-filled config fails loudly at
 * startup rather than at the first parent's login attempt.
 */
export function readParentAuthConfig(env: NodeJS.ProcessEnv): ParentAuthConfig {
  if (!env.GOOGLE_CLIENT_ID) return { enabled: false };

  const secret = env.PARENT_JWT_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    // Never interpolate the value being rejected -- the message ends up in
    // logs and crash reports.
    throw new Error(
      `PARENT_JWT_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters. ` +
        `Generate one with: node -e console.log(require('crypto').randomBytes(48).toString('base64url'))`,
    );
  }

  if (!env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_SECRET is required when GOOGLE_CLIENT_ID is set');
  }

  return {
    enabled: true,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    googleCallbackUrl: absoluteUrl(env.GOOGLE_CALLBACK_URL, 'GOOGLE_CALLBACK_URL'),
    frontendCallbackUrl: absoluteUrl(env.FRONTEND_CALLBACK_URL, 'FRONTEND_CALLBACK_URL'),
    secret,
    accessTtlSeconds: positiveInt(
      env.PARENT_ACCESS_TTL_SECONDS,
      DEFAULT_ACCESS_TTL_SECONDS,
      'PARENT_ACCESS_TTL_SECONDS',
    ),
    refreshTtlDays: positiveInt(
      env.PARENT_REFRESH_TTL_DAYS,
      DEFAULT_REFRESH_TTL_DAYS,
      'PARENT_REFRESH_TTL_DAYS',
    ),
    refreshCookiePath: env.PARENT_REFRESH_COOKIE_PATH || '/',
  };
}

export default registerAs('parentAuth', (): ParentAuthConfig => readParentAuthConfig(process.env));
