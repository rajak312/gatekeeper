import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';
import type { Env } from '../config/env';
import { sha256 } from '../common/crypto';
import { OAuthError } from '../common/errors';
import type { AuditService } from '../audit/audit.service';
import { JwtService, accessTokenHash } from '../keys/jwt.service';
import { KeysService } from '../keys/keys.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FakePrisma } from '../testing/fake-prisma';
import type { Client } from '../generated/prisma/client';
import { s256 } from './pkce';
import type { ScopeRegistry } from './scope-registry.service';
import { TokenService } from './token.service';

const env = {
  ISSUER_URL: 'https://idp.example.com',
  KEY_ENCRYPTION_SECRET: 'unit-test-secret-unit-test-secret-1234',
  RETIRED_KEY_TTL: 3600,
  ID_TOKEN_TTL: 3600,
  ACCESS_TOKEN_TTL: 900,
} as Env;

const VERIFIER = 'a'.repeat(20) + 'B'.repeat(20) + '-._~' + 'z'.repeat(10);
const REDIRECT = 'https://app.example.com/callback';
const meta = { ip: '127.0.0.1', userAgent: 'vitest' };

async function expectOAuthError(p: Promise<unknown>, error: string): Promise<OAuthError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OAuthError);
  expect((err as OAuthError).error).toBe(error);
  return err as OAuthError;
}

describe('TokenService', () => {
  let prisma: FakePrisma;
  let tokens: TokenService;
  let audit: { record: ReturnType<typeof vi.fn> };
  let client: Client;
  let otherClient: Client;

  const defaults = {
    grant: () => ({ revokedAt: null, revokedReason: null }),
    refreshToken: () => ({ usedAt: null, revokedAt: null }),
    accessToken: () => ({ revokedAt: null }),
  };

  beforeEach(async () => {
    prisma = new FakePrisma(defaults);
    const keys = new KeysService(prisma as unknown as PrismaService, env);
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    const scopes = { known: async () => new Set(['openid', 'profile', 'email', 'offline_access', 'api:read']) };
    tokens = new TokenService(
      prisma as unknown as PrismaService,
      new JwtService(keys, env),
      audit as unknown as AuditService,
      scopes as unknown as ScopeRegistry,
      env,
    );
    const base = {
      type: 'PUBLIC',
      grantTypes: ['authorization_code', 'refresh_token'],
      allowedScopes: ['openid', 'profile', 'email', 'offline_access'],
      accessTokenTtl: 600,
      refreshTokenTtl: 3600,
      disabledAt: null,
    };
    client = (await prisma.model('client').create({ data: { ...base, clientId: 'app' } })) as unknown as Client;
    otherClient = (await prisma.model('client').create({ data: { ...base, clientId: 'other' } })) as unknown as Client;
    await prisma.model('user').create({
      data: {
        id: 'user-1',
        email: 'ada@example.com',
        name: 'Ada',
        roles: ['USER'],
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
        disabledAt: null,
      },
    });
  });

  async function issueCode(overrides: Record<string, unknown> = {}): Promise<string> {
    const code = `code-${Math.random()}`;
    await prisma.model('authorizationCode').create({
      data: {
        codeHash: sha256(code),
        clientId: client.id,
        userId: 'user-1',
        sessionId: 'session-1',
        redirectUri: REDIRECT,
        scopes: ['openid', 'profile', 'offline_access'],
        nonce: 'nonce-123',
        codeChallenge: s256(VERIFIER),
        codeChallengeMethod: 'S256',
        authTime: new Date(),
        amr: ['pwd'],
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
        grantId: null,
        ...overrides,
      },
    });
    return code;
  }

  const exchange = (code: string, extra: Record<string, string> = {}, c: Client = client) =>
    tokens.exchangeAuthorizationCode(c, { code, redirect_uri: REDIRECT, code_verifier: VERIFIER, ...extra }, meta);

  describe('authorization_code', () => {
    it('issues access, ID and refresh tokens with the expected claims', async () => {
      const res = await exchange(await issueCode());
      expect(res.token_type).toBe('Bearer');
      expect(res.scope).toBe('openid profile offline_access');
      expect(res.refresh_token).toMatch(/^gkrt_/);

      const id = decodeJwt(res.id_token!);
      expect(id).toMatchObject({
        iss: env.ISSUER_URL,
        sub: 'user-1',
        aud: 'app',
        azp: 'app',
        nonce: 'nonce-123',
        name: 'Ada',
        sid: 'session-1',
      });
      expect(id.at_hash).toBe(accessTokenHash(res.access_token));

      const at = decodeJwt(res.access_token);
      expect(at).toMatchObject({ sub: 'user-1', client_id: 'app', scope: 'openid profile offline_access' });
      expect(at.resource_access).toEqual({ app: { roles: [] } });
    });

    it('does not issue a refresh token without offline_access', async () => {
      const res = await exchange(await issueCode({ scopes: ['openid'] }));
      expect(res.refresh_token).toBeUndefined();
      expect(res.id_token).toBeDefined();
    });

    it('rejects a wrong PKCE verifier and burns the code', async () => {
      const code = await issueCode();
      await expectOAuthError(exchange(code, { code_verifier: 'x'.repeat(43) }), 'invalid_grant');
      // Even the correct verifier can't redeem it afterwards.
      await expectOAuthError(exchange(code), 'invalid_grant');
    });

    it('rejects a mismatched redirect_uri', async () => {
      await expectOAuthError(
        exchange(await issueCode(), { redirect_uri: 'https://app.example.com/other' }),
        'invalid_grant',
      );
    });

    it('rejects an expired code', async () => {
      await expectOAuthError(exchange(await issueCode({ expiresAt: new Date(Date.now() - 1) })), 'invalid_grant');
    });

    it('rejects a code issued to another client', async () => {
      await expectOAuthError(exchange(await issueCode(), {}, otherClient), 'invalid_grant');
    });

    it('detects code reuse and revokes every token issued from it', async () => {
      const code = await issueCode();
      const first = await exchange(code);
      await expectOAuthError(exchange(code), 'invalid_grant');

      const grant = prisma.table('grant')[0]!;
      expect(grant.revokedReason).toBe('authorization_code_reuse');
      expect(await tokens.validateAccessToken(first.access_token)).toBeNull();
      await expectOAuthError(tokens.refresh(client, { refresh_token: first.refresh_token }, meta), 'invalid_grant');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'token.code_reuse_detected', success: false }),
      );
    });
  });

  describe('refresh_token rotation', () => {
    it('rotates the refresh token on every use', async () => {
      const first = await exchange(await issueCode());
      const second = await tokens.refresh(client, { refresh_token: first.refresh_token }, meta);
      expect(second.refresh_token).toBeDefined();
      expect(second.refresh_token).not.toBe(first.refresh_token);
      expect(second.access_token).not.toBe(first.access_token);

      const rows = prisma.table('refreshToken');
      const old = rows.find((r) => r.tokenHash === sha256(first.refresh_token!))!;
      const next = rows.find((r) => r.tokenHash === sha256(second.refresh_token!))!;
      expect(old.usedAt).toBeInstanceOf(Date);
      expect(next.parentId).toBe(old.id);
      expect(next.grantId).toBe(old.grantId);
      // The ID token on refresh carries no nonce.
      expect(decodeJwt(second.id_token!).nonce).toBeUndefined();
    });

    it('revokes the whole token family when a rotated-out token is replayed', async () => {
      const first = await exchange(await issueCode());
      const second = await tokens.refresh(client, { refresh_token: first.refresh_token }, meta);
      const third = await tokens.refresh(client, { refresh_token: second.refresh_token }, meta);

      // Attacker replays the stolen first token.
      const err = await expectOAuthError(
        tokens.refresh(client, { refresh_token: first.refresh_token }, meta),
        'invalid_grant',
      );
      expect(err.description).toMatch(/reuse/i);

      // The legitimate client's newest tokens are dead too.
      await expectOAuthError(tokens.refresh(client, { refresh_token: third.refresh_token }, meta), 'invalid_grant');
      expect(await tokens.validateAccessToken(third.access_token)).toBeNull();
      expect(prisma.table('grant')[0]!.revokedReason).toBe('refresh_token_reuse');
      expect(prisma.table('refreshToken').every((r) => r.revokedAt instanceof Date)).toBe(true);
      expect(prisma.table('accessToken').every((r) => r.revokedAt instanceof Date)).toBe(true);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'token.reuse_detected' }));
    });

    it('allows narrowing but not widening the scope', async () => {
      const first = await exchange(await issueCode());
      await expectOAuthError(
        tokens.refresh(client, { refresh_token: first.refresh_token, scope: 'openid email' }, meta),
        'invalid_scope',
      );
    });

    it('narrows the access token scope when a subset is requested', async () => {
      const first = await exchange(await issueCode());
      const narrowed = await tokens.refresh(
        client,
        { refresh_token: first.refresh_token, scope: 'openid offline_access' },
        meta,
      );
      expect(narrowed.scope).toBe('openid offline_access');
    });

    it('rejects a refresh token presented by a different client', async () => {
      const first = await exchange(await issueCode());
      await expectOAuthError(
        tokens.refresh(otherClient, { refresh_token: first.refresh_token }, meta),
        'invalid_grant',
      );
    });

    it('rejects unknown and expired refresh tokens', async () => {
      await expectOAuthError(tokens.refresh(client, { refresh_token: 'gkrt_nope' }, meta), 'invalid_grant');
      const first = await exchange(await issueCode());
      prisma.table('refreshToken')[0]!.expiresAt = new Date(Date.now() - 1);
      await expectOAuthError(tokens.refresh(client, { refresh_token: first.refresh_token }, meta), 'invalid_grant');
    });
  });

  describe('client_credentials', () => {
    it('is refused for public clients', async () => {
      await expectOAuthError(tokens.clientCredentials(client, {}, meta), 'unauthorized_client');
    });

    it('issues a token for a confidential client, without user scopes', async () => {
      const svc = (await prisma.model('client').create({
        data: {
          clientId: 'svc',
          type: 'CONFIDENTIAL',
          grantTypes: ['client_credentials'],
          allowedScopes: ['api:read'],
          accessTokenTtl: 300,
        },
      })) as unknown as Client;
      const res = await tokens.clientCredentials(svc, {}, meta);
      expect(res.scope).toBe('api:read');
      expect(res.refresh_token).toBeUndefined();
      expect(res.id_token).toBeUndefined();
      expect(decodeJwt(res.access_token)).toMatchObject({ sub: 'svc', client_id: 'svc' });
      await expectOAuthError(tokens.clientCredentials(svc, { scope: 'openid' }, meta), 'invalid_scope');
    });
  });

  describe('introspection & revocation', () => {
    it('reports active tokens and stops after revocation (RFC 7009 / 7662)', async () => {
      const res = await exchange(await issueCode());
      expect(await tokens.introspect(res.access_token, undefined)).toMatchObject({
        active: true,
        sub: 'user-1',
        client_id: 'app',
      });
      expect(await tokens.introspect(res.refresh_token!, 'refresh_token')).toMatchObject({
        active: true,
        token_type: 'refresh_token',
      });

      await tokens.revoke(client, res.refresh_token!, 'refresh_token', meta);
      expect(await tokens.introspect(res.refresh_token!, undefined)).toEqual({ active: false });
      // Revoking the refresh token revokes the access tokens of the same grant.
      expect(await tokens.introspect(res.access_token, undefined)).toEqual({ active: false });
      expect(await tokens.introspect('garbage', undefined)).toEqual({ active: false });
    });

    it('ignores revocation requests for tokens of another client', async () => {
      const res = await exchange(await issueCode());
      await tokens.revoke(otherClient, res.access_token, 'access_token', meta);
      expect(await tokens.introspect(res.access_token, undefined)).toMatchObject({ active: true });
    });
  });
});
