import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { InteractionDetails } from '@gatekeeper/shared';
import { ENV, type Env } from '../config/env';
import { randomToken, sha256 } from '../common/crypto';
import { ApiError } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService, type SessionWithUser } from '../sessions/sessions.service';
import type { Client, Interaction } from '../generated/prisma/client';
import { isValidS256Challenge } from './pkce';
import { buildRedirect, redirectUriMatches } from './redirect-uri';
import { checkScopes, missingConsent, parseScope } from './scopes';
import { ScopeRegistry } from './scope-registry.service';

const INTERACTION_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const PROMPTS = new Set(['none', 'login', 'consent', 'select_account']);

/** Validated parameters of an authorization request, persisted on the Interaction. */
export interface AuthorizationParams {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  nonce?: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  prompt: string[];
  maxAge?: number;
}

export type Query = Record<string, unknown>;

@Injectable()
export class AuthorizeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly scopes: ScopeRegistry,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Errors that must NOT be redirected to the client (unknown client / bad redirect_uri). */
  errorPage(error: string, description: string): string {
    const url = new URL('/error', this.env.WEB_URL);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', description);
    return url.toString();
  }

  private clientError(params: { redirectUri: string; state?: string }, error: string, description: string): string {
    return buildRedirect(params.redirectUri, {
      error,
      error_description: description,
      state: params.state,
      iss: this.env.ISSUER_URL, // RFC 9207 mix-up protection
    });
  }

  /** Entry point for GET /oauth/authorize. Returns the URL to redirect the browser to. */
  async authorize(query: Query, req: Request): Promise<string> {
    const str = (k: string): string | undefined => {
      const v = query[k];
      return typeof v === 'string' && v.length ? v : undefined;
    };
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) return this.errorPage('invalid_request', `Parameter "${k}" was repeated`);
    }

    const clientId = str('client_id');
    if (!clientId) return this.errorPage('invalid_request', 'client_id is required');
    const client = await this.prisma.client.findUnique({ where: { clientId } });
    if (!client || client.disabledAt) return this.errorPage('invalid_client', 'Unknown or disabled client');

    const redirectUri = str('redirect_uri');
    if (!redirectUri) return this.errorPage('invalid_request', 'redirect_uri is required');
    if (!redirectUriMatches(redirectUri, client.redirectUris)) {
      return this.errorPage('invalid_request', 'redirect_uri is not registered for this client');
    }

    // From here on, errors are safe to send back to the (verified) redirect_uri.
    const state = str('state');
    const back = (error: string, description: string) => this.clientError({ redirectUri, state }, error, description);

    if (query.request !== undefined) return back('request_not_supported', 'Request objects are not supported');
    if (query.request_uri !== undefined) return back('request_uri_not_supported', 'request_uri is not supported');
    if (str('response_type') !== 'code') {
      return back('unsupported_response_type', 'Only response_type=code is supported');
    }
    const responseMode = str('response_mode');
    if (responseMode && responseMode !== 'query')
      return back('invalid_request', 'Only response_mode=query is supported');
    if (!client.grantTypes.includes('authorization_code')) {
      return back('unauthorized_client', 'Client is not allowed to use the authorization code grant');
    }

    const codeChallenge = str('code_challenge');
    const method = str('code_challenge_method');
    if (!codeChallenge) return back('invalid_request', 'PKCE is required: code_challenge missing');
    if (method !== 'S256') return back('invalid_request', 'code_challenge_method must be S256');
    if (!isValidS256Challenge(codeChallenge)) return back('invalid_request', 'code_challenge is malformed');

    const requested = parseScope(str('scope'));
    if (!requested.length) return back('invalid_scope', 'scope is required');
    const check = checkScopes(requested, client.allowedScopes, await this.scopes.known());
    if (!check.ok) return back('invalid_scope', `Scope not allowed: ${check.invalid.join(' ')}`);

    const prompt = parseScope(str('prompt'));
    if (prompt.some((p) => !PROMPTS.has(p))) return back('invalid_request', 'Unsupported prompt value');
    if (prompt.includes('none') && prompt.length > 1) return back('invalid_request', 'prompt=none cannot be combined');

    let maxAge: number | undefined;
    const rawMaxAge = str('max_age');
    if (rawMaxAge !== undefined) {
      if (!/^\d{1,9}$/.test(rawMaxAge)) return back('invalid_request', 'max_age must be a non-negative integer');
      maxAge = Number(rawMaxAge);
    }

    const nonce = str('nonce');
    if (nonce && nonce.length > 512) return back('invalid_request', 'nonce is too long');
    if (state && state.length > 2048) return back('invalid_request', 'state is too long');

    const params: AuthorizationParams = {
      clientId,
      redirectUri,
      scopes: check.scopes,
      state,
      nonce,
      codeChallenge,
      codeChallengeMethod: 'S256',
      prompt,
      maxAge,
    };
    const interaction = await this.prisma.interaction.create({
      data: {
        id: randomToken(18),
        clientId: client.id,
        params: params as never,
        expiresAt: new Date(Date.now() + INTERACTION_TTL_MS),
      },
    });
    return this.resume(interaction.id, req, { fresh: true });
  }

  private async loadInteraction(
    id: string,
  ): Promise<{ interaction: Interaction; params: AuthorizationParams; client: Client } | null> {
    if (!id || id.length > 100) return null;
    const interaction = await this.prisma.interaction.findUnique({ where: { id } });
    if (!interaction || interaction.completedAt || interaction.expiresAt <= new Date()) return null;
    const client = await this.prisma.client.findUnique({ where: { id: interaction.clientId } });
    if (!client || client.disabledAt) return null;
    return { interaction, params: interaction.params as unknown as AuthorizationParams, client };
  }

  private needsLogin(session: SessionWithUser | null, interaction: Interaction, params: AuthorizationParams): boolean {
    if (!session?.authTime) return true;
    // prompt=login: require an authentication that happened after this request started.
    if (params.prompt.includes('login') && session.authTime < interaction.createdAt) return true;
    if (params.maxAge !== undefined && Date.now() - session.authTime.getTime() > params.maxAge * 1000) return true;
    return false;
  }

  /**
   * Continues an interaction after login/MFA. Decides between: login page,
   * consent page, or issuing the authorization code.
   */
  async resume(interactionId: string, req: Request, opts: { fresh?: boolean } = {}): Promise<string> {
    const loaded = await this.loadInteraction(interactionId);
    if (!loaded) {
      return this.errorPage(
        'interaction_expired',
        'This sign-in request has expired or was already completed. Go back to the application and try again.',
      );
    }
    const { interaction, params, client } = loaded;
    const session = await this.sessions.resolve(req);
    const back = (error: string, description: string) => {
      return this.complete(interaction.id).then(() => this.clientError(params, error, description));
    };

    if (this.needsLogin(session, interaction, params)) {
      if (params.prompt.includes('none')) return back('login_required', 'The user is not signed in');
      const url = new URL('/login', this.env.WEB_URL);
      url.searchParams.set('interaction', interaction.id);
      if (!opts.fresh || params.prompt.includes('login')) url.searchParams.set('reauth', '1');
      return url.toString();
    }
    const s = session!;
    await this.prisma.interaction.update({ where: { id: interaction.id }, data: { sessionId: s.id } });

    if (await this.needsConsent(s.userId, client, params)) {
      if (params.prompt.includes('none')) return back('consent_required', 'The user has not approved this application');
      const url = new URL('/consent', this.env.WEB_URL);
      url.searchParams.set('interaction', interaction.id);
      return url.toString();
    }
    return this.issueCode(interaction.id, params, client, s);
  }

  private async needsConsent(userId: string, client: Client, params: AuthorizationParams): Promise<boolean> {
    if (params.prompt.includes('consent')) return true;
    if (!client.requireConsent) return false;
    const consent = await this.prisma.consent.findUnique({
      where: { userId_clientId: { userId, clientId: client.id } },
    });
    return missingConsent(params.scopes, consent?.scopes ?? []).length > 0;
  }

  /** Data for the consent page. The interaction must belong to the caller's session. */
  async details(interactionId: string, session: SessionWithUser | null): Promise<InteractionDetails> {
    const loaded = await this.loadInteraction(interactionId);
    if (!loaded) throw new ApiError(HttpStatus.NOT_FOUND, 'interaction_not_found', 'This sign-in request has expired');
    const { interaction, params, client } = loaded;
    if (session && interaction.sessionId && interaction.sessionId !== session.id) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'interaction_session_mismatch',
        'This request belongs to another session',
      );
    }
    const descriptions = await this.scopes.all();
    const consent = session
      ? await this.prisma.consent.findUnique({
          where: { userId_clientId: { userId: session.userId, clientId: client.id } },
        })
      : null;
    return {
      id: interaction.id,
      client: {
        clientId: client.clientId,
        name: client.name,
        description: client.description,
        logoUrl: client.logoUrl,
      },
      scopes: params.scopes.map((name) => ({
        name,
        description: descriptions.get(name) ?? name,
        alreadyGranted: consent?.scopes.includes(name) ?? false,
      })),
      user: session ? { email: session.user.email, name: session.user.name } : null,
      redirectUri: params.redirectUri,
    };
  }

  async decide(
    interactionId: string,
    session: SessionWithUser,
    decision: { decision: 'allow' | 'deny'; remember: boolean },
    meta: RequestMeta,
  ): Promise<string> {
    const loaded = await this.loadInteraction(interactionId);
    if (!loaded) throw new ApiError(HttpStatus.NOT_FOUND, 'interaction_not_found', 'This sign-in request has expired');
    const { interaction, params, client } = loaded;
    if (interaction.sessionId !== session.id) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'interaction_session_mismatch',
        'This request belongs to another session',
      );
    }
    if (decision.decision === 'deny') {
      await this.complete(interaction.id);
      await this.audit.record({
        type: 'consent.denied',
        actorId: session.userId,
        actorEmail: session.user.email,
        clientId: client.clientId,
        meta,
      });
      return this.clientError(params, 'access_denied', 'The user denied the request');
    }
    if (decision.remember) {
      const existing = await this.prisma.consent.findUnique({
        where: { userId_clientId: { userId: session.userId, clientId: client.id } },
      });
      const scopes = [...new Set([...(existing?.scopes ?? []), ...params.scopes])];
      await this.prisma.consent.upsert({
        where: { userId_clientId: { userId: session.userId, clientId: client.id } },
        create: { userId: session.userId, clientId: client.id, scopes },
        update: { scopes },
      });
    }
    await this.audit.record({
      type: 'consent.granted',
      actorId: session.userId,
      actorEmail: session.user.email,
      clientId: client.clientId,
      meta,
      metadata: { scopes: params.scopes, remembered: decision.remember },
    });
    return this.issueCode(interaction.id, params, client, session);
  }

  private async complete(interactionId: string): Promise<boolean> {
    const { count } = await this.prisma.interaction.updateMany({
      where: { id: interactionId, completedAt: null },
      data: { completedAt: new Date() },
    });
    return count === 1;
  }

  private async issueCode(
    interactionId: string,
    params: AuthorizationParams,
    client: Client,
    session: SessionWithUser,
  ): Promise<string> {
    if (!(await this.complete(interactionId))) {
      return this.errorPage('interaction_expired', 'This sign-in request was already completed');
    }
    const code = randomToken(32);
    await this.prisma.authorizationCode.create({
      data: {
        codeHash: sha256(code),
        clientId: client.id,
        userId: session.userId,
        sessionId: session.id,
        redirectUri: params.redirectUri,
        scopes: params.scopes,
        nonce: params.nonce ?? null,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        authTime: session.authTime ?? new Date(),
        amr: session.amr,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return buildRedirect(params.redirectUri, { code, state: params.state, iss: this.env.ISSUER_URL });
  }
}
