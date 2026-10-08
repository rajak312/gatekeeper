import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import { createHarness, DEMO_USER, location, obtainTokens, type Agent, type Harness } from './harness';

const ACME = { id: 'acme-reports', secret: 'gks_demo_acme_reports_secret_change_me' };
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

function refresh(agent: Agent, token: string, extra: Record<string, string> = {}) {
  return agent
    .post('/oauth/token')
    .type('form')
    .send({ grant_type: 'refresh_token', client_id: 'playground', refresh_token: token, ...extra });
}

describe('Tokens: refresh rotation, revocation, introspection, client credentials, logout', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  describe('refresh token rotation with reuse detection', () => {
    it('rotates refresh tokens and keeps the family usable', async () => {
      const agent = h.agent();
      const t0 = await obtainTokens(agent);
      const t1 = (await refresh(agent, t0.refresh_token!).expect(200)).body;
      expect(t1.refresh_token).not.toBe(t0.refresh_token);
      expect(t1.id_token).toBeTruthy();
      const t2 = (await refresh(agent, t1.refresh_token).expect(200)).body;
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${t2.access_token}`).expect(200);
    });

    it('revokes the whole family when an old refresh token is replayed', async () => {
      const agent = h.agent();
      const t0 = await obtainTokens(agent);
      const t1 = (await refresh(agent, t0.refresh_token!).expect(200)).body;

      const replay = await refresh(agent, t0.refresh_token!).expect(400);
      expect(replay.body.error).toBe('invalid_grant');
      expect(replay.body.error_description).toMatch(/reuse detected/i);

      // Every token of the family is now dead - including the legitimate newest ones.
      expect((await refresh(agent, t1.refresh_token).expect(400)).body.error).toBe('invalid_grant');
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${t1.access_token}`).expect(401);
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${t0.access_token}`).expect(401);

      const events = await h.prisma.auditEvent.findMany({ where: { type: 'token.reuse_detected' } });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]!.success).toBe(false);
    });

    it('rejects scope escalation on refresh', async () => {
      const agent = h.agent();
      const t0 = await obtainTokens(agent, 'openid offline_access');
      const res = await refresh(agent, t0.refresh_token!, { scope: 'openid email offline_access' }).expect(400);
      expect(res.body.error).toBe('invalid_scope');
    });
  });

  describe('userinfo', () => {
    it('requires a bearer token', async () => {
      const res = await h.agent().get('/oauth/userinfo').expect(401);
      expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
    });

    it('rejects a forged token', async () => {
      const agent = h.agent();
      const t = await obtainTokens(agent);
      const [hd, , sig] = t.access_token.split('.');
      const forged = Buffer.from(JSON.stringify({ ...decodeJwt(t.access_token), sub: 'someone-else' })).toString(
        'base64url',
      );
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${hd}.${forged}.${sig}`).expect(401);
    });

    it('releases only claims covered by the granted scopes', async () => {
      const agent = h.agent();
      const t = await obtainTokens(agent, 'openid');
      const info = await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${t.access_token}`).expect(200);
      expect(Object.keys(info.body)).toEqual(['sub']);
    });
  });

  describe('revocation (RFC 7009) and introspection (RFC 7662)', () => {
    it('introspects tokens for authenticated confidential clients', async () => {
      const agent = h.agent();
      const t = await obtainTokens(agent);
      const res = await agent
        .post('/oauth/introspect')
        .set('Authorization', basic(ACME.id, ACME.secret))
        .type('form')
        .send({ token: t.access_token })
        .expect(200);
      expect(res.body).toMatchObject({
        active: true,
        client_id: 'playground',
        username: DEMO_USER.email,
        token_type: 'Bearer',
      });
    });

    it('refuses introspection by public clients and bad credentials', async () => {
      const t = await obtainTokens(h.agent());
      await h
        .agent()
        .post('/oauth/introspect')
        .type('form')
        .send({ client_id: 'playground', token: t.access_token })
        .expect(401);
      const bad = await h
        .agent()
        .post('/oauth/introspect')
        .set('Authorization', basic(ACME.id, 'wrong'))
        .type('form')
        .send({ token: t.access_token })
        .expect(401);
      expect(bad.body.error).toBe('invalid_client');
      expect(bad.headers['www-authenticate']).toMatch(/^Basic/);
    });

    it('revokes an access token immediately', async () => {
      const agent = h.agent();
      const t = await obtainTokens(agent);
      await agent
        .post('/oauth/revoke')
        .type('form')
        .send({ client_id: 'playground', token: t.access_token, token_type_hint: 'access_token' })
        .expect(200);
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${t.access_token}`).expect(401);
      const res = await agent
        .post('/oauth/introspect')
        .set('Authorization', basic(ACME.id, ACME.secret))
        .type('form')
        .send({ token: t.access_token })
        .expect(200);
      expect(res.body).toEqual({ active: false });
    });

    it('revoking a refresh token kills the grant', async () => {
      const agent = h.agent();
      const t = await obtainTokens(agent);
      await agent
        .post('/oauth/revoke')
        .type('form')
        .send({ client_id: 'playground', token: t.refresh_token })
        .expect(200);
      expect((await refresh(agent, t.refresh_token!).expect(400)).body.error).toBe('invalid_grant');
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${t.access_token}`).expect(401);
    });

    it('answers 200 for unknown tokens (no token probing)', async () => {
      await h
        .agent()
        .post('/oauth/revoke')
        .type('form')
        .send({ client_id: 'playground', token: 'does-not-exist' })
        .expect(200);
    });
  });

  describe('client_credentials', () => {
    it('issues a machine token to a confidential client', async () => {
      const res = await h
        .agent()
        .post('/oauth/token')
        .set('Authorization', basic(ACME.id, ACME.secret))
        .type('form')
        .send({ grant_type: 'client_credentials' })
        .expect(200);
      expect(res.body).toMatchObject({ token_type: 'Bearer', scope: 'api:read' });
      expect(res.body.refresh_token).toBeUndefined();
      expect(decodeJwt(res.body.access_token)).toMatchObject({ sub: 'acme-reports', client_id: 'acme-reports' });
    });

    it('accepts client_secret_post too', async () => {
      await h
        .agent()
        .post('/oauth/token')
        .type('form')
        .send({ grant_type: 'client_credentials', client_id: ACME.id, client_secret: ACME.secret })
        .expect(200);
    });

    it('rejects a wrong secret and public clients', async () => {
      const wrong = await h
        .agent()
        .post('/oauth/token')
        .set('Authorization', basic(ACME.id, 'nope'))
        .type('form')
        .send({ grant_type: 'client_credentials' })
        .expect(401);
      expect(wrong.body.error).toBe('invalid_client');
      const pub = await h
        .agent()
        .post('/oauth/token')
        .type('form')
        .send({ grant_type: 'client_credentials', client_id: 'playground' })
        .expect(400);
      expect(pub.body.error).toBe('unauthorized_client');
    });
  });

  describe('RP-initiated logout', () => {
    it('logs out directly with a valid id_token_hint and redirects to a registered URI', async () => {
      const agent = h.agent();
      const t = await obtainTokens(agent);
      const res = await agent
        .get('/oauth/logout')
        .query({
          id_token_hint: t.id_token!,
          post_logout_redirect_uri: 'http://localhost:3500/playground',
          state: 'bye',
        })
        .expect(302);
      const loc = location(res);
      expect(loc.pathname).toBe('/playground');
      expect(loc.searchParams.get('state')).toBe('bye');
      await agent.get('/api/auth/me').expect(401);
      // Without offline_access the session-bound grant would die; with it the refresh token survives by design.
      await refresh(agent, t.refresh_token!).expect(200);
    });

    it('asks for confirmation without an id_token_hint (logout CSRF protection)', async () => {
      const agent = h.agent();
      await obtainTokens(agent);
      const res = await agent
        .get('/oauth/logout')
        .query({ client_id: 'playground', post_logout_redirect_uri: 'http://localhost:3500/playground' })
        .expect(302);
      expect(location(res).pathname).toBe('/logout');
      await agent.get('/api/auth/me').expect(200);
    });

    it('ignores unregistered post_logout_redirect_uri values', async () => {
      const agent = h.agent();
      const t = await obtainTokens(agent);
      const res = await agent
        .get('/oauth/logout')
        .query({ id_token_hint: t.id_token!, post_logout_redirect_uri: 'https://evil.example.com' })
        .expect(302);
      const loc = location(res);
      expect(loc.origin).toBe('http://localhost:3500');
      expect(loc.pathname).toBe('/logout');
    });

    it('ends access for non-offline grants of the session', async () => {
      const agent = h.agent();
      const t = await obtainTokens(agent, 'openid profile');
      await agent.get('/oauth/logout').query({ id_token_hint: t.id_token! }).expect(302);
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${t.access_token}`).expect(401);
    });
  });
});
