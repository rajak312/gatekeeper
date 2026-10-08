import { describe, expect, it } from 'vitest';
import { checkScopes, formatScope, isSubset, missingConsent, parseScope } from './scopes';

const known = new Set(['openid', 'profile', 'email', 'offline_access', 'api:read']);

describe('scope handling', () => {
  it('parses space-delimited scopes, dropping empties and duplicates', () => {
    expect(parseScope('openid  profile openid')).toEqual(['openid', 'profile']);
    expect(parseScope('')).toEqual([]);
    expect(parseScope(undefined)).toEqual([]);
    expect(formatScope(['openid', 'email'])).toBe('openid email');
  });

  it('accepts scopes that are both known and allowed for the client', () => {
    expect(checkScopes(['openid', 'api:read'], ['openid', 'api:read', 'profile'], known)).toEqual({
      ok: true,
      scopes: ['openid', 'api:read'],
    });
  });

  it('rejects scopes the client is not allowed to request', () => {
    expect(checkScopes(['openid', 'email'], ['openid'], known)).toEqual({ ok: false, invalid: ['email'] });
  });

  it('rejects scopes unknown to the server even if the client lists them', () => {
    expect(checkScopes(['admin'], ['admin'], known)).toEqual({ ok: false, invalid: ['admin'] });
  });

  it('rejects scope tokens with illegal characters (RFC 6749 §3.3)', () => {
    const weird = 'open"id';
    expect(checkScopes([weird], [weird], new Set([weird]))).toEqual({ ok: false, invalid: [weird] });
  });

  it('computes subsets and missing consent', () => {
    expect(isSubset(['openid'], ['openid', 'email'])).toBe(true);
    expect(isSubset(['openid', 'api:write'], ['openid', 'email'])).toBe(false);
    expect(missingConsent(['openid', 'email', 'api:read'], ['openid', 'email'])).toEqual(['api:read']);
    expect(missingConsent(['openid'], ['openid', 'email'])).toEqual([]);
  });
});
