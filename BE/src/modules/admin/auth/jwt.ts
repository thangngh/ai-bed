import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AdminJwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

/** base64url only: no `+`, no `/`, no `=` padding. */
const B64URL_ONLY = /^[A-Za-z0-9_-]+$/;

function encodeSegment(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function hmac(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function signAdminToken(
  claims: { sub: string; username: string },
  secret: string,
  ttlSeconds: number,
  now: number = nowSeconds(),
): string {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeSegment({
    sub: claims.sub,
    username: claims.username,
    iat: now,
    exp: now + ttlSeconds,
  });
  const signature = hmac(`${header}.${payload}`, secret).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyAdminToken(
  token: string,
  secret: string,
  now: number = nowSeconds(),
): AdminJwtPayload | null {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!parts.every((part) => B64URL_ONLY.test(part))) return null;

  let header: any;
  let payload: any;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null;

  // Hard equality, not a lookup table. none and RS256 must never reach the
  // signature comparison below.
  if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

  // HMAC over the bytes as they arrived. Re-serialising the parsed JSON would
  // let a payload differing only in key order or whitespace verify.
  const expected = hmac(`${headerB64}.${payloadB64}`, secret);
  const actual = Buffer.from(signatureB64, 'base64url');
  // timingSafeEqual throws when lengths differ, so this check comes first.
  if (actual.length !== expected.length) return null;
  if (!timingSafeEqual(actual, expected)) return null;

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (typeof payload.username !== 'string' || payload.username.length === 0) return null;
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
  // A token without a usable exp is rejected, never treated as eternal.
  if (payload.exp <= now) return null;

  return { sub: payload.sub, username: payload.username, iat: payload.iat, exp: payload.exp };
}
