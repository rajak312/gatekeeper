import { describe, expect, it } from 'vitest';
import { atHash, base64url, randomString, s256 } from './pkce';
import { decodeJwt } from './jwt';
import { describeUserAgent, formatDuration } from './format';

describe('browser PKCE helpers', () => {
  it('matches the RFC 7636 Appendix B vector', async () => {
    expect(await s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('generates 43-char url-safe verifiers', () => {
    const v = randomString();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomString()).not.toBe(v);
  });

  it('base64url-encodes without padding', () => {
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('computes at_hash as the left half of SHA-256', async () => {
    expect(await atHash('abc')).toBe('ungWv48Bz-pBQUDeXa4iIw');
  });
});

describe('decodeJwt', () => {
  it('decodes header and payload, including UTF-8', () => {
    const enc = (o: object) => base64url(new TextEncoder().encode(JSON.stringify(o)));
    const token = `${enc({ alg: 'RS256', kid: 'k1' })}.${enc({ sub: '1', name: 'Zoë' })}.sig`;
    expect(decodeJwt(token)).toMatchObject({ header: { kid: 'k1' }, payload: { name: 'Zoë' } });
  });

  it('returns null for garbage', () => {
    expect(decodeJwt('nope')).toBeNull();
    expect(decodeJwt('a.b.c')).toBeNull();
  });
});

describe('format helpers', () => {
  it('summarises user agents', () => {
    expect(
      describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'),
    ).toBe('Chrome on macOS');
    expect(describeUserAgent(null)).toBe('Unknown device');
  });

  it('formats durations', () => {
    expect(formatDuration(900)).toBe('15m');
    expect(formatDuration(86400 * 30)).toBe('30d');
    expect(formatDuration(45)).toBe('45s');
  });
});
