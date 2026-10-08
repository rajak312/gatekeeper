import { describe, expect, it } from 'vitest';
import { redactUrl } from './logging';

describe('redactUrl', () => {
  it('removes credentials from query strings before logging', () => {
    const out = redactUrl('/oauth/logout?id_token_hint=eyJhbGci.secret.sig&state=abc')!;
    expect(out).not.toContain('eyJhbGci');
    expect(out).toContain('state=abc');
  });

  it('leaves URLs without a query untouched', () => {
    expect(redactUrl('/health')).toBe('/health');
  });
});
