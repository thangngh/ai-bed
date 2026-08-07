import { createHmac } from 'node:crypto';
import { signAdminToken, verifyAdminToken } from '../jwt';

const SECRET = 'a'.repeat(48);
const NOW = 1_800_000_000;
const CLAIMS = { sub: 'admin-uuid-1', username: 'thang' };

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Build a token by hand so tests can control every segment independently. */
function forge(header: unknown, payload: unknown, secret = SECRET): string {
  const h = b64(header);
  const p = b64(payload);
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

describe('signAdminToken', () => {
  it('produces three base64url segments', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('sets iat to now and exp to now + ttl', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload).toEqual({ sub: 'admin-uuid-1', username: 'thang', iat: NOW, exp: NOW + 3600 });
  });
});

describe('verifyAdminToken', () => {
  it('round-trips a freshly signed token', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    expect(verifyAdminToken(token, SECRET, NOW)).toEqual({
      sub: 'admin-uuid-1', username: 'thang', iat: NOW, exp: NOW + 3600,
    });
  });

  it('rejects alg: none', () => {
    const h = b64({ alg: 'none', typ: 'JWT' });
    const p = b64({ ...CLAIMS, iat: NOW, exp: NOW + 3600 });
    expect(verifyAdminToken(`${h}.${p}.`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(`${h}.${p}.AAAA`, SECRET, NOW)).toBeNull();
  });

  it('rejects alg: RS256 even when the HMAC happens to match', () => {
    // Signed correctly with HMAC but declaring RS256: accepting this is the
    // classic algorithm-confusion hole.
    const token = forge({ alg: 'RS256', typ: 'JWT' }, { ...CLAIMS, iat: NOW, exp: NOW + 3600 });
    expect(verifyAdminToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const [h, , s] = token.split('.');
    const swapped = b64({ sub: 'someone-else', username: 'attacker', iat: NOW, exp: NOW + 3600 });
    expect(verifyAdminToken(`${h}.${swapped}.${s}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const [h, p, s] = token.split('.');
    const flipped = s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
    expect(verifyAdminToken(`${h}.${p}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signAdminToken(CLAIMS, 'b'.repeat(48), 3600, NOW);
    expect(verifyAdminToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a token with no exp claim', () => {
    const token = forge({ alg: 'HS256', typ: 'JWT' }, { ...CLAIMS, iat: NOW });
    expect(verifyAdminToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token, including exactly at exp', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    expect(verifyAdminToken(token, SECRET, NOW + 3600)).toBeNull();
    expect(verifyAdminToken(token, SECRET, NOW + 3601)).toBeNull();
    expect(verifyAdminToken(token, SECRET, NOW + 3599)).not.toBeNull();
  });

  it('rejects tokens that do not have exactly three segments', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const [h, p, s] = token.split('.');
    expect(verifyAdminToken(`${h}.${p}`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(`${h}.${p}.${s}.${s}`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken('', SECRET, NOW)).toBeNull();
  });

  it('rejects standard base64 spellings of a valid token', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const [h, p, s] = token.split('.');
    // Same bytes, different alphabet. Accepting both would mean one logical
    // token has two spellings.
    const std = Buffer.from(s, 'base64url').toString('base64');
    if (std !== s) expect(verifyAdminToken(`${h}.${p}.${std}`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(`${h}.${p}.${s}=`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(`${h}.${p}.${s}+`, SECRET, NOW)).toBeNull();
  });

  it('rejects a token whose header or payload is not JSON', () => {
    const notJson = Buffer.from('hello').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(`${notJson}.${notJson}`).digest('base64url');
    expect(verifyAdminToken(`${notJson}.${notJson}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a token missing sub or username', () => {
    expect(verifyAdminToken(forge({ alg: 'HS256', typ: 'JWT' }, { username: 'thang', iat: NOW, exp: NOW + 60 }), SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(forge({ alg: 'HS256', typ: 'JWT' }, { sub: 'x', iat: NOW, exp: NOW + 60 }), SECRET, NOW)).toBeNull();
  });
});
