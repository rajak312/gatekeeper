import { describe, expect, it } from 'vitest';
import { isValidCodeVerifier, isValidS256Challenge, s256, verifyPkce } from './pkce';

describe('PKCE (RFC 7636)', () => {
  // Test vector from RFC 7636 Appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('computes the S256 challenge from the RFC test vector', () => {
    expect(s256(verifier)).toBe(challenge);
  });

  it('accepts the matching verifier', () => {
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
  });

  it('rejects a different verifier', () => {
    expect(verifyPkce(verifier.replace(/.$/, 'x'), challenge, 'S256')).toBe(false);
  });

  it('rejects the plain method even when the values match', () => {
    expect(verifyPkce(verifier, verifier, 'plain')).toBe(false);
  });

  it('rejects verifiers outside 43..128 chars or with illegal characters', () => {
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(128))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
    expect(isValidCodeVerifier(`${'a'.repeat(42)}+`)).toBe(false);
    expect(verifyPkce('short', s256('short'), 'S256')).toBe(false);
  });

  it('validates the shape of an S256 challenge', () => {
    expect(isValidS256Challenge(challenge)).toBe(true);
    expect(isValidS256Challenge(`${challenge}=`)).toBe(false);
    expect(isValidS256Challenge(challenge.slice(1))).toBe(false);
    expect(isValidS256Challenge(challenge.replace('-', '+'))).toBe(false);
  });
});
