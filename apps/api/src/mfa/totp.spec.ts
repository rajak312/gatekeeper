import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hotp,
  normalizeRecoveryCode,
  otpauthUrl,
  totp,
  verifyTotp,
} from './totp';

// RFC 6238 Appendix B uses the ASCII secret "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  it('matches the RFC 4226 HOTP test vectors', () => {
    const secret = Buffer.from('12345678901234567890', 'ascii');
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => expect(hotp(secret, counter)).toBe(code));
  });

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at T=%i', (seconds, code) => {
    expect(totp(RFC_SECRET, seconds * 1000)).toBe(code);
  });

  it('round-trips base32', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(() => base32Decode('abc1')).toThrow();
  });

  it('generates 160-bit secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('accepts the current code and ±1 step of clock drift, nothing more', () => {
    const now = 1_700_000_000_000;
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, totp(secret, now), { nowMs: now })).toBe(Math.floor(now / 30000));
    expect(verifyTotp(secret, totp(secret, now - 30_000), { nowMs: now })).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now + 30_000), { nowMs: now })).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 90_000), { nowMs: now })).toBeNull();
  });

  it('rejects replay of an already used time step', () => {
    const now = 1_700_000_000_000;
    const secret = generateTotpSecret();
    const code = totp(secret, now);
    const step = verifyTotp(secret, code, { nowMs: now });
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, { nowMs: now, lastUsedStep: step })).toBeNull();
    // An older (but in-window) code is also rejected once a newer step was used.
    expect(verifyTotp(secret, totp(secret, now - 30_000), { nowMs: now, lastUsedStep: step })).toBeNull();
  });

  it('rejects malformed codes', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, '12345')).toBeNull();
    expect(verifyTotp(secret, 'abcdef')).toBeNull();
    expect(verifyTotp(secret, '1234567')).toBeNull();
  });

  it('builds an otpauth:// URI that authenticator apps understand', () => {
    const url = new URL(otpauthUrl('JBSWY3DPEHPK3PXP', 'ada@example.com', 'Gatekeeper'));
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/Gatekeeper:ada@example.com');
    expect(url.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(url.searchParams.get('issuer')).toBe('Gatekeeper');
  });

  it('generates unique, human-friendly recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(normalizeRecoveryCode(' AB12-cd34-EF56 ')).toBe('ab12cd34ef56');
  });
});
