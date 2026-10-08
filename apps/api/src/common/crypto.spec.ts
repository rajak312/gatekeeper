import { describe, expect, it } from 'vitest';
import { Encryptor, randomToken, safeEqual, sha256 } from './crypto';

describe('crypto helpers', () => {
  it('randomToken is url-safe and unique', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('sha256 is deterministic hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('safeEqual compares correctly regardless of length', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'secreT')).toBe(false);
    expect(safeEqual('secret', 'secret-longer')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('Encryptor (AES-256-GCM)', () => {
  const enc = new Encryptor('a-very-long-key-encryption-secret-for-tests');

  it('round-trips plaintext with a random IV', () => {
    const a = enc.encrypt('hello', 'ctx');
    const b = enc.encrypt('hello', 'ctx');
    expect(a).not.toBe(b);
    expect(enc.decrypt(a, 'ctx')).toBe('hello');
  });

  it('fails if the ciphertext is tampered with', () => {
    const c = enc.encrypt('hello', 'ctx').split('.');
    const body = Buffer.from(c[3]!, 'base64url');
    body[0]! ^= 1;
    c[3] = body.toString('base64url');
    expect(() => enc.decrypt(c.join('.'), 'ctx')).toThrow();
  });

  it('binds the ciphertext to its context (AAD)', () => {
    const c = enc.encrypt('hello', 'totp:user-1');
    expect(() => enc.decrypt(c, 'totp:user-2')).toThrow();
  });

  it('cannot be decrypted with a different secret', () => {
    const c = enc.encrypt('hello');
    expect(() => new Encryptor('another-key-encryption-secret-1234567890').decrypt(c)).toThrow();
  });
});
