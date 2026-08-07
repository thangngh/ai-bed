import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: Record<string, number>,
) => Promise<Buffer>;

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * 128 * N * r is exactly 32MB at these parameters, and Node's default maxmem
 * is also 32MB -- calling scrypt without raising it throws
 * ERR_CRYPTO_INVALID_SCRYPT_PARAM rather than returning a hash.
 */
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const digest = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n <= 1 || r < 1 || p < 1) return false;

  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    // The stored parameters drive the derivation, so raising N later leaves
    // every existing hash verifiable.
    actual = await scryptAsync(password, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

let cached: Promise<string> | null = null;

/**
 * A real hash of a value nobody knows. The login path verifies against it when
 * the username does not exist, so an unknown username costs the same scrypt
 * time as a known one -- without it, response latency turns the endpoint into
 * a username oracle.
 */
export function dummyPasswordHash(): Promise<string> {
  if (!cached) cached = hashPassword(randomBytes(32).toString('hex'));
  return cached;
}
