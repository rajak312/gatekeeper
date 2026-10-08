import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { JWTPayload } from 'jose';
import { ENV, type Env } from '../config/env';
import { randomToken, sha256 } from '../common/crypto';
import { OAuthError } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { JwtService, accessTokenHash, InvalidTokenError } from '../keys/jwt.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Client, Grant, User } from '../generated/prisma/client';
import { USER_SCOPES, userClaims } from './claims';
import { verifyPkce } from './pkce';
import { checkScopes, formatScope, isSubset, parseScope } from './scopes';
import { ScopeRegistry } from './scope-registry.service';

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  id_token?: string;
  refresh_token?: string;
}

const REFRESH_PREFIX = 'gkrt_';

export type TokenBody = Record<string, string | undefined>;

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly scopes: ScopeRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------------ grants

  async exchangeAuthorizationCode(client: Client, body: TokenBody, meta: RequestMeta): Promise<TokenResponse> {
    const { code, redirect_uri: redirectUri, code_verifier: verifier } = body;
    if (!code) throw new OAuthError('invalid_request', 'code is required');
    if (!redirectUri) throw new OAuthError('invalid_request', 'redirect_uri is required');
    if (!verifier) throw new OAuthError('invalid_request', 'code_verifier is required (PKCE)');

    const record = await this.prisma.authorizationCode.findUnique({ where: { codeHash: sha256(code) } });
    if (!record || record.clientId !== client.id) {
      throw new OAuthError('invalid_grant', 'Invalid authorization code');
    }

    // Single use, enforced atomically. A code is burned on the first attempt even
    // if that attempt fails, so a stolen code can't be used to guess a verifier.
    const { count } = await this.prisma.authorizationCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) {
      // RFC 6749 §4.1.2: on code reuse, revoke tokens already issued from it.
      if (record.grantId) await this.revokeGrant(record.grantId, 'authorization_code_reuse');
      await this.audit.record({
        type: 'token.code_reuse_detected',
        success: false,
        subjectId: record.userId,
        clientId: client.clientId,
        meta,
        metadata: { grantId: record.grantId },
      });
      throw new OAuthError('invalid_grant', 'Authorization code has already been used');
    }

    const fail = async (description: string, reason: string): Promise<never> => {
      await this.audit.record({
        type: 'token.exchange_failed',
        success: false,
        subjectId: record.userId,
        clientId: client.clientId,
        meta,
        metadata: { reason },
      });
      throw new OAuthError('invalid_grant', description);
    };

    if (record.expiresAt <= new Date()) return fail('Authorization code has expired', 'expired');
    if (record.redirectUri !== redirectUri)
      return fail('redirect_uri does not match the authorization request', 'redirect_uri_mismatch');
    if (!verifyPkce(verifier, record.codeChallenge, record.codeChallengeMethod)) {
      return fail('PKCE verification failed', 'pkce_mismatch');
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.disabledAt) return fail('The user account is not active', 'user_inactive');

    const grant = await this.prisma.grant.create({
      data: {
        clientId: client.id,
        userId: user.id,
        sessionId: record.sessionId,
        grantType: 'authorization_code',
        scopes: record.scopes,
        authTime: record.authTime,
        amr: record.amr,
      },
    });
    await this.prisma.authorizationCode.update({ where: { id: record.id }, data: { grantId: grant.id } });

    const response = await this.issue(client, grant, user, record.scopes, { nonce: record.nonce ?? undefined });
    await this.audit.record({
      type: 'token.issued',
      subjectId: user.id,
      actorEmail: user.email,
      clientId: client.clientId,
      meta,
      metadata: { grant_type: 'authorization_code', scope: response.scope, refresh: Boolean(response.refresh_token) },
    });
    return response;
  }

  async refresh(client: Client, body: TokenBody, meta: RequestMeta): Promise<TokenResponse> {
    const presented = body.refresh_token;
    if (!presented) throw new OAuthError('invalid_request', 'refresh_token is required');

    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(presented) },
      include: { grant: { include: { user: true } } },
    });
    if (!token || token.grant.clientId !== client.id) throw new OAuthError('invalid_grant', 'Invalid refresh token');
    if (token.grant.revokedAt || token.revokedAt)
      throw new OAuthError('invalid_grant', 'Refresh token has been revoked');

    const reuse = async (): Promise<never> => {
      // Refresh token rotation with reuse detection (OAuth 2.1 §4.3.1 / Security BCP §4.14):
      // a rotated-out token being presented again means it was copied. We can't tell
      // whether the attacker or the client is the legitimate holder, so the whole
      // token family (grant) is revoked and the user has to sign in again.
      await this.revokeGrant(token.grantId, 'refresh_token_reuse');
      await this.audit.record({
        type: 'token.reuse_detected',
        success: false,
        subjectId: token.grant.userId,
        actorEmail: token.grant.user?.email ?? null,
        clientId: client.clientId,
        meta,
        metadata: { grantId: token.grantId, tokenId: token.id },
      });
      throw new OAuthError('invalid_grant', 'Refresh token reuse detected - all tokens in this family were revoked');
    };

    if (token.usedAt) return reuse();
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) return reuse(); // lost a race with a concurrent use of the same token

    if (token.expiresAt <= new Date()) throw new OAuthError('invalid_grant', 'Refresh token has expired');
    const user = token.grant.user;
    if (!user || user.disabledAt) {
      await this.revokeGrant(token.grantId, 'user_inactive');
      throw new OAuthError('invalid_grant', 'The user account is not active');
    }

    let scopes = token.scopes;
    if (body.scope !== undefined) {
      const requested = parseScope(body.scope);
      if (!requested.length || !isSubset(requested, token.scopes)) {
        throw new OAuthError('invalid_scope', 'Requested scope exceeds the original grant');
      }
      scopes = requested;
    }

    const response = await this.issue(client, token.grant, user, scopes, { parentRefreshId: token.id });
    await this.audit.record({
      type: 'token.refreshed',
      subjectId: user.id,
      actorEmail: user.email,
      clientId: client.clientId,
      meta,
      metadata: { grantId: token.grantId },
    });
    return response;
  }

  async clientCredentials(client: Client, body: TokenBody, meta: RequestMeta): Promise<TokenResponse> {
    if (client.type !== 'CONFIDENTIAL' || !client.grantTypes.includes('client_credentials')) {
      throw new OAuthError('unauthorized_client', 'This client may not use the client_credentials grant');
    }
    const allowed = client.allowedScopes.filter((s) => !USER_SCOPES.has(s));
    const requested = body.scope !== undefined ? parseScope(body.scope) : allowed;
    if (requested.some((s) => USER_SCOPES.has(s))) {
      throw new OAuthError(
        'invalid_scope',
        'User scopes (openid, profile, ...) are not available to client_credentials',
      );
    }
    const check = checkScopes(requested, allowed, await this.scopes.known());
    if (!check.ok) throw new OAuthError('invalid_scope', `Scope not allowed: ${check.invalid.join(' ')}`);

    const grant = await this.prisma.grant.create({
      data: { clientId: client.id, grantType: 'client_credentials', scopes: check.scopes },
    });
    const response = await this.issue(client, grant, null, check.scopes, {});
    await this.audit.record({
      type: 'token.issued',
      clientId: client.clientId,
      meta,
      metadata: { grant_type: 'client_credentials', scope: response.scope },
    });
    return response;
  }

  // ------------------------------------------------------------------ minting

  private async issue(
    client: Client,
    grant: Grant,
    user: User | null,
    scopes: string[],
    opts: { nonce?: string; parentRefreshId?: string },
  ): Promise<TokenResponse> {
    const ttl = client.accessTokenTtl;
    const jti = randomUUID();
    const clientRoles = user ? await this.clientRoles(user.id, client.id) : [];

    const accessClaims: JWTPayload = {
      sub: user?.id ?? client.clientId,
      aud: client.clientId,
      client_id: client.clientId,
      scope: formatScope(scopes),
      jti,
    };
    if (user) {
      accessClaims.auth_time = grant.authTime ? Math.floor(grant.authTime.getTime() / 1000) : undefined;
      if (grant.sessionId) accessClaims.sid = grant.sessionId;
      accessClaims.roles = user.roles.map((r) => r.toLowerCase());
      // Keycloak-style per-client roles: only the roles for the requesting client.
      accessClaims.resource_access = { [client.clientId]: { roles: clientRoles } };
    }

    const accessToken = await this.jwt.sign(accessClaims, { typ: 'at+jwt', expiresInSeconds: ttl });
    await this.prisma.accessToken.create({
      data: { jti, grantId: grant.id, scopes, expiresAt: new Date(Date.now() + ttl * 1000) },
    });

    const response: TokenResponse = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ttl,
      scope: formatScope(scopes),
    };

    if (user && scopes.includes('openid')) {
      const idClaims: JWTPayload = {
        ...userClaims(user, scopes, clientRoles),
        aud: client.clientId,
        azp: client.clientId,
        auth_time: grant.authTime ? Math.floor(grant.authTime.getTime() / 1000) : undefined,
        amr: grant.amr.length ? grant.amr : undefined,
        at_hash: accessTokenHash(accessToken),
        nonce: opts.nonce,
        sid: grant.sessionId ?? undefined,
      };
      response.id_token = await this.jwt.sign(idClaims, { expiresInSeconds: this.env.ID_TOKEN_TTL });
    }

    if (user && scopes.includes('offline_access') && client.grantTypes.includes('refresh_token')) {
      const refresh = REFRESH_PREFIX + randomToken(32);
      await this.prisma.refreshToken.create({
        data: {
          tokenHash: sha256(refresh),
          grantId: grant.id,
          parentId: opts.parentRefreshId ?? null,
          scopes: grant.scopes,
          expiresAt: new Date(Date.now() + client.refreshTokenTtl * 1000),
        },
      });
      response.refresh_token = refresh;
    }
    return response;
  }

  private async clientRoles(userId: string, clientDbId: string): Promise<string[]> {
    const rows = await this.prisma.userClientRole.findMany({
      where: { userId, clientRole: { clientId: clientDbId } },
      include: { clientRole: true },
    });
    return rows.map((r) => r.clientRole.name).sort();
  }

  /** Revokes a grant and therefore every access and refresh token in its family. */
  async revokeGrant(grantId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.grant.updateMany({
        where: { id: grantId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      }),
      this.prisma.refreshToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.accessToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
  }

  // ------------------------------------------------------------------ validation

  /**
   * Validates a JWT access token *and* checks server-side state, so revoked
   * tokens are rejected immediately at userinfo / introspection.
   */
  async validateAccessToken(
    token: string,
  ): Promise<{ payload: JWTPayload; grant: Grant & { user: User | null; client: Client } } | null> {
    let payload: JWTPayload;
    try {
      payload = await this.jwt.verify(token, { typ: 'at+jwt' });
    } catch (err) {
      if (err instanceof InvalidTokenError) return null;
      throw err;
    }
    if (!payload.jti) return null;
    const record = await this.prisma.accessToken.findUnique({
      where: { jti: payload.jti },
      include: { grant: { include: { user: true, client: true } } },
    });
    if (!record || record.revokedAt || record.grant.revokedAt || record.expiresAt <= new Date()) return null;
    if (record.grant.user?.disabledAt) return null;
    return { payload, grant: record.grant };
  }

  async userinfo(token: string): Promise<Record<string, unknown>> {
    const result = await this.validateAccessToken(token);
    if (!result) {
      throw new OAuthError('invalid_token', 'The access token is invalid, expired or revoked', 401, {
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      });
    }
    const scopes = parseScope(result.payload.scope as string | undefined);
    const user = result.grant.user;
    if (!user || !scopes.includes('openid')) {
      throw new OAuthError('insufficient_scope', 'The openid scope is required', 403, {
        'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="openid"',
      });
    }
    return userClaims(user, scopes, await this.clientRoles(user.id, result.grant.clientId));
  }

  /** RFC 7009. Always succeeds from the client's point of view. */
  async revoke(client: Client, token: string, hint: string | undefined, meta: RequestMeta): Promise<void> {
    const tryRefresh = async (): Promise<boolean> => {
      const rt = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(token) },
        include: { grant: true },
      });
      if (!rt) return false;
      if (rt.grant.clientId === client.id) {
        await this.revokeGrant(rt.grantId, 'revoked_by_client');
        await this.audit.record({
          type: 'token.revoked',
          clientId: client.clientId,
          subjectId: rt.grant.userId,
          meta,
          metadata: { token_type: 'refresh_token' },
        });
      }
      return true;
    };
    const tryAccess = async (): Promise<boolean> => {
      let payload: JWTPayload;
      try {
        payload = await this.jwt.verify(token, { typ: 'at+jwt', allowExpired: true });
      } catch {
        return false;
      }
      if (payload.client_id !== client.clientId || !payload.jti) return true;
      await this.prisma.accessToken.updateMany({
        where: { jti: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        type: 'token.revoked',
        clientId: client.clientId,
        subjectId: payload.sub ?? null,
        meta,
        metadata: { token_type: 'access_token' },
      });
      return true;
    };
    if (hint === 'access_token') {
      if (!(await tryAccess())) await tryRefresh();
    } else if (!(await tryRefresh())) {
      await tryAccess();
    }
  }

  /** RFC 7662. */
  async introspect(token: string, hint: string | undefined): Promise<Record<string, unknown>> {
    const inactive = { active: false };
    const asRefresh = async (): Promise<Record<string, unknown> | null> => {
      if (!token.startsWith(REFRESH_PREFIX)) return null;
      const rt = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(token) },
        include: { grant: { include: { client: true, user: true } } },
      });
      if (!rt) return null;
      if (rt.revokedAt || rt.usedAt || rt.grant.revokedAt || rt.expiresAt <= new Date()) return inactive;
      return {
        active: true,
        token_type: 'refresh_token',
        scope: formatScope(rt.scopes),
        client_id: rt.grant.client.clientId,
        sub: rt.grant.userId ?? rt.grant.client.clientId,
        username: rt.grant.user?.email,
        exp: Math.floor(rt.expiresAt.getTime() / 1000),
        iat: Math.floor(rt.createdAt.getTime() / 1000),
        iss: this.env.ISSUER_URL,
      };
    };
    const asAccess = async (): Promise<Record<string, unknown> | null> => {
      const result = await this.validateAccessToken(token);
      if (!result) return null;
      const p = result.payload;
      return {
        active: true,
        token_type: 'Bearer',
        scope: p.scope,
        client_id: p.client_id,
        sub: p.sub,
        username: result.grant.user?.email,
        aud: p.aud,
        iss: p.iss,
        exp: p.exp,
        iat: p.iat,
        jti: p.jti,
      };
    };
    const order = hint === 'refresh_token' ? [asRefresh, asAccess] : [asAccess, asRefresh];
    for (const fn of order) {
      const r = await fn();
      if (r) return r;
    }
    return inactive;
  }
}
