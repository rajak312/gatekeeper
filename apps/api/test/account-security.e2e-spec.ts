import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, jwtVerify } from 'jose';
import {
  createHarness,
  csrf,
  currentTotp,
  DEMO_ADMIN,
  DEMO_USER,
  login,
  obtainTokens,
  pkcePair,
  runAuthorizationFlow,
  type Agent,
  type Harness,
} from './harness';

let counter = 0;
async function signup(h: Harness, password = 'correct horse battery') {
  const agent = h.agent();
  const email = `user${++counter}-${Date.now()}@example.com`;
  const token = await csrf(agent);
  await agent
    .post('/api/auth/signup')
    .set('x-csrf-token', token)
    .send({ name: 'Test User', email, password })
    .expect(201);
  return { agent, email, password };
}

// Note: fetch the CSRF token *before* creating the request - superagent attaches cookies at creation time.
async function post(agent: Agent, url: string, body: object = {}) {
  const token = await csrf(agent);
  return agent.post(url).set('x-csrf-token', token).send(body);
}

async function del(agent: Agent, url: string) {
  const token = await csrf(agent);
  return agent.delete(url).set('x-csrf-token', token);
}

describe('Accounts, MFA, CSRF, lockout & admin', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  describe('CSRF protection', () => {
    it('rejects state-changing requests without the CSRF header', async () => {
      const agent = h.agent();
      await csrf(agent);
      const res = await agent
        .post('/api/auth/login')
        .send({ email: DEMO_USER.email, password: DEMO_USER.password })
        .expect(403);
      expect(res.body.code).toBe('csrf_token');
    });

    it('rejects a mismatching CSRF token', async () => {
      const agent = h.agent();
      await csrf(agent);
      await agent
        .post('/api/auth/login')
        .set('x-csrf-token', 'forged')
        .send({ email: DEMO_USER.email, password: DEMO_USER.password })
        .expect(403);
    });

    it('rejects requests from a foreign Origin even with a valid token', async () => {
      const agent = h.agent();
      const token = await csrf(agent);
      const res = await agent
        .post('/api/auth/login')
        .set('x-csrf-token', token)
        .set('Origin', 'https://evil.example.com')
        .send({ email: DEMO_USER.email, password: DEMO_USER.password })
        .expect(403);
      expect(res.body.code).toBe('csrf_origin');
    });
  });

  describe('signup, login & lockout', () => {
    it('signs up, signs in, and writes a verification email to the outbox', async () => {
      const { agent, email } = await signup(h);
      const me = await agent.get('/api/auth/me').expect(200);
      expect(me.body).toMatchObject({ email, emailVerified: false, mfaEnabled: false, roles: ['USER'] });

      const mail = await h.prisma.outboxEmail.findFirst({ where: { to: email, template: 'verify-email' } });
      expect(mail).toBeTruthy();
      const token = new URL(/https?:\/\/\S+/.exec(mail!.text)![0]).searchParams.get('token')!;
      await post(agent, '/api/auth/verify-email', { token }).then((r) => expect(r.status).toBe(200));
      expect((await agent.get('/api/auth/me')).body.emailVerified).toBe(true);
      // Single use.
      expect((await post(agent, '/api/auth/verify-email', { token })).status).toBe(400);
    });

    it('stores passwords with argon2id', async () => {
      const { email } = await signup(h);
      const user = await h.prisma.user.findUnique({ where: { email } });
      expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('rejects duplicate signups and weak passwords', async () => {
      const agent = h.agent();
      const token = await csrf(agent);
      await agent
        .post('/api/auth/signup')
        .set('x-csrf-token', token)
        .send({ name: 'X', email: DEMO_USER.email, password: 'whatever123' })
        .expect(409);
      const weak = await agent
        .post('/api/auth/signup')
        .set('x-csrf-token', token)
        .send({ name: 'X', email: 'weak@example.com', password: 'short' })
        .expect(400);
      expect(weak.body.code).toBe('validation_failed');
    });

    it('returns the same error for unknown users and wrong passwords', async () => {
      const a = await login(h.agent(), 'nobody@example.com', 'whatever123').expect(401);
      const b = await login(h.agent(), DEMO_USER.email, 'wrong-password').expect(401);
      expect(a.body.message).toBe(b.body.message);
      expect(a.body.code).toBe('invalid_credentials');
    });

    it('locks the account after repeated failures, even for the right password', async () => {
      const { email, password } = await signup(h);
      for (let i = 0; i < 5; i++) await login(h.agent(), email, 'wrong-password').expect(401);
      const locked = await login(h.agent(), email, password).expect(429);
      expect(locked.body.code).toBe('account_locked');
      expect(await h.prisma.auditEvent.count({ where: { type: 'user.locked', actorEmail: email } })).toBe(1);

      // An admin can unlock it.
      const admin = h.agent();
      await login(admin, DEMO_ADMIN.email, DEMO_ADMIN.password).expect(200);
      const user = await h.prisma.user.findUniqueOrThrow({ where: { email } });
      expect((await post(admin, `/api/admin/users/${user.id}/unlock`)).status).toBe(200);
      await login(h.agent(), email, password).expect(200);
    });

    it('rate limits login attempts per client IP', async () => {
      process.env.TEST_ENABLE_THROTTLE = 'true';
      try {
        const agent = h.agent();
        const statuses: number[] = [];
        for (let i = 0; i < 12; i++) statuses.push((await login(agent, 'ratelimit@example.com', 'whatever123')).status);
        expect(statuses).toContain(429);
      } finally {
        delete process.env.TEST_ENABLE_THROTTLE;
      }
    });

    it('rotates the session on login (no session fixation)', async () => {
      const agent = h.agent();
      await login(agent, DEMO_USER.email, DEMO_USER.password).expect(200);
      const first = await h.prisma.session.findFirst({ orderBy: { createdAt: 'desc' } });
      await login(agent, DEMO_USER.email, DEMO_USER.password).expect(200);
      const old = await h.prisma.session.findUnique({ where: { id: first!.id } });
      expect(old!.revokedAt).not.toBeNull();
    });
  });

  describe('TOTP MFA', () => {
    it('enrolls, requires the second factor, rejects replays, and accepts recovery codes', async () => {
      const { agent, email, password } = await signup(h);

      const setup = await post(agent, '/api/account/mfa/setup');
      expect(setup.status).toBe(200);
      expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      const secret: string = setup.body.secret;

      // Secret is encrypted at rest.
      const row = await h.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(row.totpSecretEnc).not.toContain(secret);

      expect((await post(agent, '/api/account/mfa/activate', { code: '000000' })).status).toBe(400);
      const activated = await post(agent, '/api/account/mfa/activate', { code: currentTotp(secret) });
      expect(activated.status).toBe(200);
      const recoveryCodes: string[] = activated.body.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);

      // Password alone is no longer enough.
      const browser = h.agent();
      const first = await login(browser, email, password).expect(200);
      expect(first.body).toEqual({ status: 'mfa_required', redirectTo: '/mfa' });
      await browser.get('/api/auth/me').expect(401);
      await browser.get('/api/account/sessions').expect(401);

      // The code used during activation can't be replayed.
      const replay = await post(browser, '/api/auth/mfa', { code: currentTotp(secret) });
      expect(replay.status).toBe(401);
      // The next time step works.
      const ok = await post(browser, '/api/auth/mfa', { code: currentTotp(secret, 1) });
      expect(ok.status).toBe(200);
      const me = await browser.get('/api/auth/me').expect(200);
      expect(me.body.mfaEnabled).toBe(true);

      // ID tokens carry the authentication methods used.
      const { verifier, challenge } = pkcePair();
      const loc = await runAuthorizationFlow(browser, { challenge });
      const tokens = await browser
        .post('/oauth/token')
        .type('form')
        .send({
          grant_type: 'authorization_code',
          client_id: 'playground',
          code: loc.searchParams.get('code'),
          redirect_uri: 'http://localhost:3500/playground/callback',
          code_verifier: verifier,
        })
        .expect(200);
      const jwks = createLocalJWKSet((await browser.get('/.well-known/jwks.json')).body);
      const { payload } = await jwtVerify(tokens.body.id_token, jwks);
      expect(payload.amr).toEqual(['pwd', 'otp', 'mfa']);

      // Recovery codes are single use.
      const r1 = h.agent();
      await login(r1, email, password).expect(200);
      expect((await post(r1, '/api/auth/mfa', { recoveryCode: recoveryCodes[0] })).status).toBe(200);
      const r2 = h.agent();
      await login(r2, email, password).expect(200);
      expect((await post(r2, '/api/auth/mfa', { recoveryCode: recoveryCodes[0] })).status).toBe(401);
      expect((await post(r2, '/api/auth/mfa', { recoveryCode: recoveryCodes[1]!.toUpperCase() })).status).toBe(200);
      expect(await h.prisma.auditEvent.count({ where: { type: 'mfa.recovery_code_used', actorEmail: email } })).toBe(2);
    });

    it('kills the pending sign-in after too many wrong codes', async () => {
      const { agent, email, password } = await signup(h);
      const { body } = await post(agent, '/api/account/mfa/setup');
      await post(agent, '/api/account/mfa/activate', { code: currentTotp(body.secret) });

      const browser = h.agent();
      await login(browser, email, password).expect(200);
      for (let i = 0; i < 4; i++) expect((await post(browser, '/api/auth/mfa', { code: '000000' })).status).toBe(401);
      const last = await post(browser, '/api/auth/mfa', { code: '000000' });
      expect(last.body.code).toBe('mfa_session_expired');
      expect((await post(browser, '/api/auth/mfa', { code: currentTotp(body.secret, 1) })).body.code).toBe(
        'mfa_session_expired',
      );
    });

    it('protects the shared demo accounts from MFA enrollment in demo mode', async () => {
      const agent = h.agent();
      await login(agent, DEMO_USER.email, DEMO_USER.password).expect(200);
      const res = await post(agent, '/api/account/mfa/setup');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('demo_protected');
    });
  });

  describe('sessions & password reset', () => {
    it('lists and revokes sessions', async () => {
      const { agent, email, password } = await signup(h);
      const other = h.agent();
      await login(other, email, password).expect(200);
      const list = await agent.get('/api/account/sessions').expect(200);
      expect(list.body).toHaveLength(2);
      const otherSession = list.body.find((s: { current: boolean }) => !s.current);
      const res = await del(agent, `/api/account/sessions/${otherSession.id}`);
      expect(res.status).toBe(200);
      await other.get('/api/auth/me').expect(401);
      await agent.get('/api/auth/me').expect(200);
    });

    it('resets the password via an emailed link and signs out everywhere', async () => {
      const { agent, email } = await signup(h);
      const tokens = await obtainTokens(agent);

      expect((await post(h.agent(), '/api/auth/forgot-password', { email })).status).toBe(200);
      // Unknown emails get the same answer.
      expect((await post(h.agent(), '/api/auth/forgot-password', { email: 'ghost@example.com' })).status).toBe(200);

      const mail = await h.prisma.outboxEmail.findFirstOrThrow({ where: { to: email, template: 'reset-password' } });
      const token = new URL(/https?:\/\/\S+/.exec(mail.text)![0]).searchParams.get('token')!;
      expect(
        (await post(h.agent(), '/api/auth/reset-password', { token, password: 'brand new password' })).status,
      ).toBe(200);
      expect((await post(h.agent(), '/api/auth/reset-password', { token, password: 'another password!' })).status).toBe(
        400,
      );

      await agent.get('/api/auth/me').expect(401);
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${tokens.access_token}`).expect(401);
      await login(h.agent(), email, 'brand new password').expect(200);
    });
  });

  describe('admin API', () => {
    async function adminAgent() {
      const agent = h.agent();
      await login(agent, DEMO_ADMIN.email, DEMO_ADMIN.password).expect(200);
      return agent;
    }

    it('is forbidden for regular users and anonymous callers', async () => {
      await h.agent().get('/api/admin/stats').expect(401);
      const user = h.agent();
      await login(user, DEMO_USER.email, DEMO_USER.password).expect(200);
      await user.get('/api/admin/stats').expect(403);
    });

    it('returns dashboard stats', async () => {
      const res = await (await adminAgent()).get('/api/admin/stats').expect(200);
      expect(res.body.totals.users).toBeGreaterThan(1);
      expect(res.body.loginsByDay).toHaveLength(14);
      expect(res.body.demoMode).toBe(true);
    });

    it('creates a confidential client and shows its secret exactly once', async () => {
      const admin = await adminAgent();
      const created = await post(admin, '/api/admin/clients', {
        name: 'Billing Service',
        type: 'CONFIDENTIAL',
        redirectUris: ['https://billing.example.com/callback'],
        allowedScopes: ['openid', 'api:read'],
        grantTypes: ['authorization_code', 'client_credentials'],
      });
      expect(created.status).toBe(201);
      const { client, clientSecret } = created.body;
      expect(clientSecret).toMatch(/^gks_/);

      const fetched = await admin.get(`/api/admin/clients/${client.id}`).expect(200);
      expect(JSON.stringify(fetched.body)).not.toContain(clientSecret);
      expect(fetched.body.secretHint).toBe(clientSecret.slice(-4));
      const row = await h.prisma.client.findUniqueOrThrow({ where: { id: client.id } });
      expect(row.secretHash).not.toBe(clientSecret);

      const auth = `Basic ${Buffer.from(`${client.clientId}:${clientSecret}`).toString('base64')}`;
      await h
        .agent()
        .post('/oauth/token')
        .set('Authorization', auth)
        .type('form')
        .send({ grant_type: 'client_credentials' })
        .expect(200);

      // Rotating the secret invalidates the old one.
      const rotated = await post(admin, `/api/admin/clients/${client.id}/secret`);
      expect(rotated.body.clientSecret).not.toBe(clientSecret);
      await h
        .agent()
        .post('/oauth/token')
        .set('Authorization', auth)
        .type('form')
        .send({ grant_type: 'client_credentials' })
        .expect(401);
      expect(
        await h.prisma.auditEvent.count({ where: { type: { in: ['client.created', 'client.secret_rotated'] } } }),
      ).toBeGreaterThanOrEqual(2);
    });

    it('validates client metadata', async () => {
      const admin = await adminAgent();
      const bad = await post(admin, '/api/admin/clients', {
        name: 'Bad',
        type: 'PUBLIC',
        redirectUris: ['http://evil.example.com/cb'],
        allowedScopes: ['openid'],
        grantTypes: ['authorization_code'],
      });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('invalid_client_metadata');
      const publicCc = await post(admin, '/api/admin/clients', {
        name: 'Bad CC',
        type: 'PUBLIC',
        redirectUris: ['https://x.example.com/cb'],
        allowedScopes: ['api:read'],
        grantTypes: ['client_credentials'],
      });
      expect(publicCc.status).toBe(400);
    });

    it('refuses to delete the protected playground client in demo mode', async () => {
      const admin = await adminAgent();
      const playground = await h.prisma.client.findUniqueOrThrow({ where: { clientId: 'playground' } });
      const res = await del(admin, `/api/admin/clients/${playground.id}`);
      expect(res.status).toBe(403);
    });

    it('locks a user, which revokes their sessions and tokens', async () => {
      const admin = await adminAgent();
      const { agent, email, password } = await signup(h);
      const tokens = await obtainTokens(agent);
      const user = await h.prisma.user.findUniqueOrThrow({ where: { email } });

      expect((await post(admin, `/api/admin/users/${user.id}/lock`, { reason: 'Suspicious activity' })).status).toBe(
        200,
      );
      await agent.get('/api/auth/me').expect(401);
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${tokens.access_token}`).expect(401);
      expect((await login(h.agent(), email, password)).status).toBe(403);
    });

    it('rotates signing keys while old tokens remain verifiable', async () => {
      const admin = await adminAgent();
      const agent = h.agent();
      const before = await obtainTokens(agent);
      const rotated = await post(admin, '/api/admin/keys/rotate');
      expect(rotated.status).toBe(200);
      expect(rotated.body.filter((k: { status: string }) => k.status === 'ACTIVE')).toHaveLength(1);

      const jwks = (await h.agent().get('/.well-known/jwks.json')).body;
      expect(jwks.keys).toHaveLength(2);
      // Old token still works (its key is still published) ...
      await agent.get('/oauth/userinfo').set('Authorization', `Bearer ${before.access_token}`).expect(200);
      // ... and new tokens are signed with the new key.
      const after = await obtainTokens(h.agent());
      const kid = (t: string) => JSON.parse(Buffer.from(t.split('.')[0]!, 'base64url').toString()).kid;
      expect(kid(after.access_token)).not.toBe(kid(before.access_token));
    });

    it('filters the audit log and pages with a cursor', async () => {
      const admin = await adminAgent();
      const failed = await admin.get('/api/admin/audit').query({ type: 'user.login_failed', limit: 2 }).expect(200);
      expect(failed.body.items).toHaveLength(2);
      expect(failed.body.items.every((e: { type: string }) => e.type === 'user.login_failed')).toBe(true);
      const next = await admin
        .get('/api/admin/audit')
        .query({ type: 'user.login_failed', limit: 2, cursor: failed.body.nextCursor })
        .expect(200);
      expect(next.body.items[0].id).not.toBe(failed.body.items[0].id);
      const prefix = await admin.get('/api/admin/audit').query({ type: 'token.' }).expect(200);
      expect(prefix.body.items.every((e: { type: string }) => e.type.startsWith('token.'))).toBe(true);
    });

    it('exposes the dev outbox', async () => {
      const res = await (await adminAgent()).get('/api/admin/outbox').expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('subject');
    });

    it('manages custom scopes', async () => {
      const admin = await adminAgent();
      const created = await post(admin, '/api/admin/scopes', { name: 'reports:read', description: 'Read reports' });
      expect(created.status).toBe(201);
      const disc = await h.agent().get('/.well-known/openid-configuration');
      expect(disc.body.scopes_supported).toContain('reports:read');
      const sys = (await admin.get('/api/admin/scopes')).body.find((s: { name: string }) => s.name === 'openid');
      const removed = await del(admin, `/api/admin/scopes/${sys.id}`);
      expect(removed.status).toBe(400);
    });
  });
});
