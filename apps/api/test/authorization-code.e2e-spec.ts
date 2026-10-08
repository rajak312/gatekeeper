import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, jwtVerify } from 'jose';
import {
  authorizeQuery,
  createHarness,
  DEMO_USER,
  exchangeCode,
  location,
  login,
  pkcePair,
  PLAYGROUND_REDIRECT,
  runAuthorizationFlow,
  type Harness,
} from './harness';

describe('Authorization Code + PKCE flow', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  describe('happy path', () => {
    it('logs in, asks for consent, issues a code and exchanges it for verified tokens', async () => {
      const agent = h.agent();
      const { verifier, challenge } = pkcePair();

      // 1. Unauthenticated browser is sent to the hosted login page.
      const start = await agent.get('/oauth/authorize').query(authorizeQuery({ challenge })).expect(302);
      const loginUrl = location(start);
      expect(loginUrl.origin + loginUrl.pathname).toBe('http://localhost:3500/login');
      const interaction = loginUrl.searchParams.get('interaction')!;

      // The login page can show which app is asking.
      const details = await agent.get(`/api/interactions/${interaction}`).expect(200);
      expect(details.body.client).toMatchObject({ clientId: 'playground', name: 'OAuth Playground' });
      expect(details.body.user).toBeNull();

      // 2. Password login, then resume the authorization request.
      const loginRes = await login(agent, DEMO_USER.email, DEMO_USER.password, interaction).expect(200);
      expect(loginRes.body).toEqual({
        status: 'authenticated',
        redirectTo: `/oauth/authorize/resume?interaction=${interaction}`,
      });
      const cookie = String(loginRes.headers['set-cookie']);
      expect(cookie).toMatch(/gk_session=.*HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);

      // 3. First time for this client -> consent screen.
      const resume = await agent.get(loginRes.body.redirectTo).expect(302);
      expect(location(resume).pathname).toBe('/consent');
      const consentInfo = await agent.get(`/api/interactions/${interaction}`).expect(200);
      expect(consentInfo.body.user.email).toBe(DEMO_USER.email);
      expect(consentInfo.body.scopes.map((s: { name: string }) => s.name)).toEqual([
        'openid',
        'profile',
        'email',
        'offline_access',
      ]);

      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const decision = await agent
        .post(`/api/interactions/${interaction}/consent`)
        .set('x-csrf-token', csrf)
        .send({ decision: 'allow', remember: true })
        .expect(200);
      const callback = new URL(decision.body.redirectTo);
      expect(callback.origin + callback.pathname).toBe(PLAYGROUND_REDIRECT);
      expect(callback.searchParams.get('state')).toBe('state-xyz');
      expect(callback.searchParams.get('iss')).toBe('http://localhost:3500');
      const code = callback.searchParams.get('code')!;
      expect(code).toBeTruthy();

      // 4. Token exchange with the PKCE verifier.
      const tokenRes = await exchangeCode(agent, code, verifier).expect(200);
      expect(tokenRes.headers['cache-control']).toBe('no-store');
      const body = tokenRes.body;
      expect(body).toMatchObject({ token_type: 'Bearer', scope: 'openid profile email offline_access' });
      expect(body.refresh_token).toMatch(/^gkrt_/);

      // 5. Verify the ID token like a relying party would, using the published JWKS.
      const jwks = createLocalJWKSet((await agent.get('/.well-known/jwks.json')).body);
      const { payload, protectedHeader } = await jwtVerify(body.id_token, jwks, {
        issuer: 'http://localhost:3500',
        audience: 'playground',
      });
      expect(protectedHeader.alg).toBe('RS256');
      expect(payload).toMatchObject({
        nonce: 'nonce-abc',
        email: DEMO_USER.email,
        email_verified: true,
        name: DEMO_USER.name,
        amr: ['pwd'],
      });

      const at = await jwtVerify(body.access_token, jwks, { issuer: 'http://localhost:3500', typ: 'at+jwt' });
      expect(at.payload.resource_access).toEqual({ playground: { roles: ['viewer'] } });

      // 6. Userinfo.
      const info = await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${body.access_token}`).expect(200);
      expect(info.body).toMatchObject({ sub: payload.sub, email: DEMO_USER.email, name: DEMO_USER.name });
    });

    it('remembers consent and skips straight to the code next time (SSO)', async () => {
      const agent = h.agent();
      const first = pkcePair();
      await runAuthorizationFlow(agent, { challenge: first.challenge });

      const second = pkcePair();
      const res = await agent
        .get('/oauth/authorize')
        .query(authorizeQuery({ challenge: second.challenge, state: 's2' }))
        .expect(302);
      const loc = location(res);
      expect(loc.origin + loc.pathname).toBe(PLAYGROUND_REDIRECT);
      expect(loc.searchParams.get('state')).toBe('s2');
      await exchangeCode(agent, loc.searchParams.get('code')!, second.verifier).expect(200);
    });

    it('asks again when new scopes are requested', async () => {
      const agent = h.agent();
      await runAuthorizationFlow(agent, { challenge: pkcePair().challenge, scope: 'openid' });
      const res = await agent
        .get('/oauth/authorize')
        .query(authorizeQuery({ challenge: pkcePair().challenge, scope: 'openid api:read' }))
        .expect(302);
      expect(location(res).pathname).toBe('/consent');
    });

    it('supports prompt=none for silent authentication', async () => {
      const anonymous = h.agent();
      const res = await anonymous
        .get('/oauth/authorize')
        .query(authorizeQuery({ challenge: pkcePair().challenge, prompt: 'none' }))
        .expect(302);
      const loc = location(res);
      expect(loc.origin + loc.pathname).toBe(PLAYGROUND_REDIRECT);
      expect(loc.searchParams.get('error')).toBe('login_required');
      expect(loc.searchParams.get('state')).toBe('state-xyz');
    });

    it('forces re-authentication with prompt=login', async () => {
      const agent = h.agent();
      await runAuthorizationFlow(agent, { challenge: pkcePair().challenge });
      const res = await agent
        .get('/oauth/authorize')
        .query(authorizeQuery({ challenge: pkcePair().challenge, prompt: 'login' }))
        .expect(302);
      const loc = location(res);
      expect(loc.pathname).toBe('/login');
      expect(loc.searchParams.get('reauth')).toBe('1');
    });
  });

  describe('authorization endpoint validation', () => {
    it('never redirects to an unregistered redirect_uri', async () => {
      const res = await h
        .agent()
        .get('/oauth/authorize')
        .query(authorizeQuery({ challenge: pkcePair().challenge, redirectUri: 'https://evil.example.com/callback' }))
        .expect(302);
      const loc = location(res);
      expect(loc.origin).toBe('http://localhost:3500');
      expect(loc.pathname).toBe('/error');
      expect(loc.searchParams.get('error')).toBe('invalid_request');
    });

    it('rejects redirect_uri variations (exact matching)', async () => {
      for (const variant of [
        `${PLAYGROUND_REDIRECT}/`,
        `${PLAYGROUND_REDIRECT}?x=1`,
        PLAYGROUND_REDIRECT.toUpperCase(),
      ]) {
        const res = await h
          .agent()
          .get('/oauth/authorize')
          .query(authorizeQuery({ challenge: pkcePair().challenge, redirectUri: variant }));
        expect(location(res).pathname).toBe('/error');
      }
    });

    it('rejects unknown clients on the error page', async () => {
      const res = await h
        .agent()
        .get('/oauth/authorize')
        .query(authorizeQuery({ challenge: pkcePair().challenge, clientId: 'nope' }));
      expect(location(res).searchParams.get('error')).toBe('invalid_client');
    });

    it.each([
      ['missing code_challenge', { code_challenge: '' }, 'invalid_request'],
      ['plain PKCE', { code_challenge_method: 'plain' }, 'invalid_request'],
      ['implicit flow', { response_type: 'token' }, 'unsupported_response_type'],
      ['unknown scope', { scope: 'openid superpowers' }, 'invalid_scope'],
      ['scope not allowed for client', { scope: 'openid admin' }, 'invalid_scope'],
      ['request objects', { request: 'eyJ...' }, 'request_not_supported'],
    ])('redirects back with an error for %s', async (_name, extra, error) => {
      const res = await h
        .agent()
        .get('/oauth/authorize')
        .query({ ...authorizeQuery({ challenge: pkcePair().challenge }), ...extra })
        .expect(302);
      const loc = location(res);
      expect(loc.origin + loc.pathname).toBe(PLAYGROUND_REDIRECT);
      expect(loc.searchParams.get('error')).toBe(error);
      expect(loc.searchParams.get('state')).toBe('state-xyz');
      expect(loc.searchParams.get('iss')).toBe('http://localhost:3500');
    });

    it('returns access_denied when the user declines consent', async () => {
      const loc = await runAuthorizationFlow(h.agent(), {
        challenge: pkcePair().challenge,
        consent: 'deny',
        prompt: 'consent',
      });
      expect(loc.searchParams.get('error')).toBe('access_denied');
      expect(loc.searchParams.get('code')).toBeNull();
    });

    it('does not let another session complete someone else’s consent', async () => {
      const victim = h.agent();
      const res = await victim
        .get('/oauth/authorize')
        .query(authorizeQuery({ challenge: pkcePair().challenge, prompt: 'consent' }))
        .expect(302);
      const interaction = location(res).searchParams.get('interaction')!;
      const loginRes = await login(victim, DEMO_USER.email, DEMO_USER.password, interaction);
      await victim.get(loginRes.body.redirectTo).expect(302);

      const attacker = h.agent();
      await login(attacker, 'admin@gatekeeper.dev', 'admin1234').expect(200);
      const csrf = (await attacker.get('/api/auth/csrf')).body.csrfToken;
      await attacker
        .post(`/api/interactions/${interaction}/consent`)
        .set('x-csrf-token', csrf)
        .send({ decision: 'allow' })
        .expect(403);
    });
  });

  describe('token endpoint negative cases', () => {
    async function freshCode() {
      const agent = h.agent();
      const pair = pkcePair();
      const loc = await runAuthorizationFlow(agent, { challenge: pair.challenge });
      return { agent, code: loc.searchParams.get('code')!, ...pair };
    }

    it('rejects a wrong code_verifier', async () => {
      const { agent, code } = await freshCode();
      const res = await exchangeCode(agent, code, pkcePair().verifier).expect(400);
      expect(res.body).toEqual({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    });

    it('rejects a missing code_verifier', async () => {
      const { agent, code } = await freshCode();
      const res = await agent
        .post('/oauth/token')
        .type('form')
        .send({ grant_type: 'authorization_code', client_id: 'playground', code, redirect_uri: PLAYGROUND_REDIRECT })
        .expect(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('rejects a mismatched redirect_uri', async () => {
      const { agent, code, verifier } = await freshCode();
      const res = await exchangeCode(agent, code, verifier, {
        redirect_uri: 'http://localhost:3500/playground',
      }).expect(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('rejects a reused code and revokes the tokens it produced', async () => {
      const { agent, code, verifier } = await freshCode();
      const first = await exchangeCode(agent, code, verifier).expect(200);
      const replay = await exchangeCode(agent, code, verifier).expect(400);
      expect(replay.body.error).toBe('invalid_grant');

      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${first.body.access_token}`).expect(401);
      const refresh = await agent
        .post('/oauth/token')
        .type('form')
        .send({ grant_type: 'refresh_token', client_id: 'playground', refresh_token: first.body.refresh_token })
        .expect(400);
      expect(refresh.body.error).toBe('invalid_grant');
      expect(await h.prisma.auditEvent.count({ where: { type: 'token.code_reuse_detected' } })).toBeGreaterThan(0);
    });

    it('rejects codes presented by a different client', async () => {
      const { agent, code, verifier } = await freshCode();
      const basic = Buffer.from('acme-reports:gks_demo_acme_reports_secret_change_me').toString('base64');
      const res = await agent
        .post('/oauth/token')
        .set('Authorization', `Basic ${basic}`)
        .type('form')
        .send({ grant_type: 'authorization_code', code, redirect_uri: PLAYGROUND_REDIRECT, code_verifier: verifier })
        .expect(400);
      expect(res.body.error).toBe('unauthorized_client');
    });

    it('rejects unsupported grant types', async () => {
      const res = await h
        .agent()
        .post('/oauth/token')
        .type('form')
        .send({ grant_type: 'password', client_id: 'playground' })
        .expect(400);
      expect(res.body.error).toBe('unsupported_grant_type');
    });

    it('rejects repeated parameters', async () => {
      const res = await h
        .agent()
        .post('/oauth/token')
        .type('form')
        .send('grant_type=authorization_code&client_id=playground&code=a&code=b')
        .expect(400);
      expect(res.body.error).toBe('invalid_request');
    });
  });
});
