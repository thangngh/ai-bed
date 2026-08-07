import { hashPassword, verifyPassword, dummyPasswordHash } from '../password';

// scrypt at N=32768 costs ~100ms per call and these tests make several.
jest.setTimeout(30_000);

describe('hashPassword', () => {
  it('produces a parameterised scrypt string, not the plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash.split('$')).toHaveLength(6);
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
  });

  it('produces a different string every time for the same password', async () => {
    const a = await hashPassword('same-password-twice');
    const b = await hashPassword('same-password-twice');
    // If these matched, the salt would not be doing anything and two admins
    // with the same password would be visibly identical in the table.
    expect(a).not.toEqual(b);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    const hash = await hashPassword('right-password-here');
    await expect(verifyPassword('right-password-here', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('right-password-here');
    await expect(verifyPassword('wrong-password-here', hash)).resolves.toBe(false);
  });

  it('rejects a password that differs only in case', async () => {
    const hash = await hashPassword('CaseSensitive123');
    await expect(verifyPassword('casesensitive123', hash)).resolves.toBe(false);
  });

  it('returns false instead of throwing on a malformed stored string', async () => {
    for (const bad of ['', 'not-a-hash', 'scrypt$1$2$3', 'bcrypt$32768$8$1$aaaa$bbbb', 'scrypt$x$8$1$aaaa$bbbb']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('rejects a hash whose stored digest has been tampered with', async () => {
    const hash = await hashPassword('tamper-target-pass');
    const parts = hash.split('$');
    parts[5] = Buffer.alloc(64, 0).toString('base64url');
    await expect(verifyPassword('tamper-target-pass', parts.join('$'))).resolves.toBe(false);
  });
});

describe('dummyPasswordHash', () => {
  it('is a valid hash that no plausible password matches', async () => {
    const dummy = await dummyPasswordHash();
    expect(dummy.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('', dummy)).resolves.toBe(false);
    await expect(verifyPassword('admin', dummy)).resolves.toBe(false);
  });

  it('returns the same value on repeat calls so the cost is paid once', async () => {
    await expect(dummyPasswordHash()).resolves.toEqual(await dummyPasswordHash());
  });
});
