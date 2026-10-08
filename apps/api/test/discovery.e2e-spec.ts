import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

describe('Discovery, JWKS, health & HTTP hardening', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('publishes OpenID Provider metadata', async () => {
    const res = await h.agent().get('/.well-known/openid-configuration').expect(200);
    expect(res.body).toMatchObject({
      issuer: 'http://localhost:3500',
      authorization_endpoint: 'http://localhost:3500/oauth/authorize',
      token_endpoint: 'http://localhost:3500/oauth/token',
      jwks_uri: 'http://localhost:3500/.well-known/jwks.json',
      end_session_endpoint: 'http://localhost:3500/oauth/logout',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      id_token_signing_alg_values_supported: ['RS256'],
      authorization_response_iss_parameter_supported: true,
    });
    expect(res.body.scopes_supported).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email', 'offline_access', 'api:read']),
    );
    expect(res.body.grant_types_supported).toEqual(['authorization_code', 'refresh_token', 'client_credentials']);
  });

  it('serves the same document as RFC 8414 metadata', async () => {
    const a = await h.agent().get('/.well-known/openid-configuration');
    const b = await h.agent().get('/.well-known/oauth-authorization-server');
    expect(b.body).toEqual(a.body);
  });

  it('publishes public signing keys only', async () => {
    const res = await h.agent().get('/.well-known/jwks.json').expect(200);
    expect(res.body.keys).toHaveLength(1);
    const [key] = res.body.keys;
    expect(key).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
    expect(key.kid).toBeTruthy();
    for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(key).not.toHaveProperty(privateField);
  });

  it('reports health including the database', async () => {
    const res = await h.agent().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: { status: 'up' } });
  });

  it('sets security headers', async () => {
    const res = await h.agent().get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows credential-less CORS on protocol endpoints for SPAs', async () => {
    const res = await h.agent().options('/oauth/token').set('Origin', 'https://spa.example.com').expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('never sends CORS headers for cookie-authenticated /api routes', async () => {
    const res = await h.agent().get('/api/auth/csrf').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the Swagger UI and OpenAPI document', async () => {
    await h.agent().get('/docs').expect(200);
    const json = await h.agent().get('/docs-json').expect(200);
    expect(Object.keys(json.body.paths)).toEqual(expect.arrayContaining(['/api/admin/clients', '/api/auth/login']));
  });
});
