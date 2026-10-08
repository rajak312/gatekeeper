import { describe, expect, it } from 'vitest';
import { buildRedirect, redirectUriMatches, validateRedirectUri } from './redirect-uri';

describe('redirect URI registration rules', () => {
  it.each([
    'https://app.example.com/callback',
    'https://app.example.com/cb?tenant=1',
    'http://localhost:3000/callback',
    'http://127.0.0.1:8080/cb',
    'http://[::1]:8080/cb',
    'com.example.app:/oauth2redirect',
  ])('accepts %s', (uri) => {
    expect(validateRedirectUri(uri)).toBeNull();
  });

  it.each([
    ['not a url', 'absolute'],
    ['https://app.example.com/cb#frag', 'fragment'],
    ['https://*.example.com/cb', 'wildcard'],
    ['http://app.example.com/cb', 'localhost'],
    ['javascript:alert(1)', 'javascript'],
    ['data:text/html,hi', 'data'],
    ['myapp:/cb', 'reverse-DNS'],
  ])('rejects %s', (uri, reason) => {
    expect(validateRedirectUri(uri)).toMatch(new RegExp(reason, 'i'));
  });
});

describe('redirect URI matching', () => {
  const registered = ['https://app.example.com/callback'];

  it('requires an exact string match', () => {
    expect(redirectUriMatches('https://app.example.com/callback', registered)).toBe(true);
    expect(redirectUriMatches('https://app.example.com/callback/', registered)).toBe(false);
    expect(redirectUriMatches('https://app.example.com/callback?x=1', registered)).toBe(false);
    expect(redirectUriMatches('https://APP.example.com/callback', registered)).toBe(false);
    expect(redirectUriMatches('https://app.example.com.evil.com/callback', registered)).toBe(false);
    expect(redirectUriMatches('http://app.example.com/callback', registered)).toBe(false);
  });

  it('appends response parameters while preserving the existing query', () => {
    const url = new URL(
      buildRedirect('https://app.example.com/cb?tenant=1', { code: 'abc', state: 'x y', skip: undefined }),
    );
    expect(url.searchParams.get('tenant')).toBe('1');
    expect(url.searchParams.get('code')).toBe('abc');
    expect(url.searchParams.get('state')).toBe('x y');
    expect(url.searchParams.has('skip')).toBe(false);
  });
});
