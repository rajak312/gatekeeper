import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  ISSUER_URL: 'https://gatekeeper-lalit.vercel.app/',
  WEB_URL: 'https://gatekeeper-lalit.vercel.app',
  KEY_ENCRYPTION_SECRET: 'x'.repeat(40),
};

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadEnv({ ...valid, NODE_ENV: 'production' });
    expect(env.PORT).toBe(4500);
    expect(env.ISSUER_URL).toBe('https://gatekeeper-lalit.vercel.app'); // trailing slash removed
    expect(env.COOKIE_SECURE).toBe(true); // secure by default in production
    expect(env.DEMO_MODE).toBe(false);
  });

  it('fails fast listing every invalid variable without echoing secret values', () => {
    try {
      loadEnv({ DATABASE_URL: 'mysql://nope', KEY_ENCRYPTION_SECRET: 'short-secret-value' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('ISSUER_URL');
      expect(msg).toContain('KEY_ENCRYPTION_SECRET');
      expect(msg).not.toContain('short-secret-value');
    }
  });

  it('allows COOKIE_SECURE to be overridden for plain-http local setups', () => {
    expect(loadEnv({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });
});
