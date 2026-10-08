import { Controller, Get, Header, HttpCode, Inject, Post, Query, Req, Res, UseFilters } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ENV, type Env } from '../config/env';
import { OAuthError } from '../common/errors';
import { OAuthErrorFilter } from '../common/oauth-error.filter';
import { requestMeta } from '../common/request';
import { KeysService } from '../keys/keys.service';
import { AuthorizeService, type Query as AuthQuery } from './authorize.service';
import { CLAIMS_SUPPORTED } from './claims';
import { ClientAuthService } from './client-auth.service';
import { LogoutService, type LogoutParams } from './logout.service';
import { ScopeRegistry } from './scope-registry.service';
import { TokenService, type TokenBody } from './token.service';

function formBody(req: Request): TokenBody {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const out: TokenBody = {};
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v)) throw new OAuthError('invalid_request', `Parameter "${k}" was repeated`);
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(req.headers.authorization ?? '');
  return m?.[1] ?? null;
}

/** OAuth 2.1 / OpenID Connect protocol endpoints. */
@ApiExcludeController()
@Controller()
@UseFilters(OAuthErrorFilter)
export class OAuthController {
  constructor(
    private readonly authorizeService: AuthorizeService,
    private readonly tokens: TokenService,
    private readonly clientAuth: ClientAuthService,
    private readonly keys: KeysService,
    private readonly scopes: ScopeRegistry,
    private readonly logoutService: LogoutService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private metadata(scopes: string[]) {
    const iss = this.env.ISSUER_URL;
    return {
      issuer: iss,
      authorization_endpoint: `${iss}/oauth/authorize`,
      token_endpoint: `${iss}/oauth/token`,
      userinfo_endpoint: `${iss}/oauth/userinfo`,
      jwks_uri: `${iss}/.well-known/jwks.json`,
      revocation_endpoint: `${iss}/oauth/revoke`,
      introspection_endpoint: `${iss}/oauth/introspect`,
      end_session_endpoint: `${iss}/oauth/logout`,
      scopes_supported: scopes,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      introspection_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      claims_supported: CLAIMS_SUPPORTED,
      prompt_values_supported: ['none', 'login', 'consent', 'select_account'],
      authorization_response_iss_parameter_supported: true,
      request_parameter_supported: false,
      request_uri_parameter_supported: false,
      claims_parameter_supported: false,
      service_documentation: `${iss}/docs`,
    };
  }

  @Get('.well-known/openid-configuration')
  @Header('Cache-Control', 'public, max-age=300')
  async discovery() {
    return this.metadata([...(await this.scopes.known())].sort());
  }

  /** RFC 8414 authorization server metadata (same document). */
  @Get('.well-known/oauth-authorization-server')
  @Header('Cache-Control', 'public, max-age=300')
  async asMetadata() {
    return this.metadata([...(await this.scopes.known())].sort());
  }

  @Get(['.well-known/jwks.json', 'oauth/jwks'])
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.keys.jwks();
  }

  @Get('oauth/authorize')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async authorize(@Query() query: AuthQuery, @Req() req: Request, @Res() res: Response): Promise<void> {
    res.redirect(302, await this.authorizeService.authorize(query, req));
  }

  /** Where the login / MFA pages send the browser once the user is authenticated. */
  @Get('oauth/authorize/resume')
  async resume(
    @Query('interaction') interaction: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(302, await this.authorizeService.resume(String(interaction ?? ''), req));
  }

  @Post('oauth/token')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async token(@Req() req: Request) {
    const body = formBody(req);
    const { client } = await this.clientAuth.authenticate(req);
    const meta = requestMeta(req);
    const grantType = body.grant_type;
    if (!grantType) throw new OAuthError('invalid_request', 'grant_type is required');
    if (!['authorization_code', 'refresh_token', 'client_credentials'].includes(grantType)) {
      throw new OAuthError('unsupported_grant_type', `Unsupported grant_type "${grantType}"`);
    }
    if (!client.grantTypes.includes(grantType)) {
      throw new OAuthError('unauthorized_client', `Client is not allowed to use ${grantType}`);
    }
    switch (grantType) {
      case 'authorization_code':
        return this.tokens.exchangeAuthorizationCode(client, body, meta);
      case 'refresh_token':
        return this.tokens.refresh(client, body, meta);
      default:
        return this.tokens.clientCredentials(client, body, meta);
    }
  }

  @Get('oauth/userinfo')
  @Header('Cache-Control', 'no-store')
  userinfoGet(@Req() req: Request) {
    return this.userinfo(req);
  }

  @Post('oauth/userinfo')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  userinfoPost(@Req() req: Request) {
    return this.userinfo(req);
  }

  private userinfo(req: Request) {
    const token = bearer(req);
    if (!token) {
      throw new OAuthError('invalid_request', 'Bearer access token required', 401, {
        'WWW-Authenticate': 'Bearer realm="gatekeeper"',
      });
    }
    return this.tokens.userinfo(token);
  }

  @Post('oauth/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revoke(@Req() req: Request): Promise<Record<string, never>> {
    const body = formBody(req);
    const { client } = await this.clientAuth.authenticate(req);
    if (!body.token) throw new OAuthError('invalid_request', 'token is required');
    await this.tokens.revoke(client, body.token, body.token_type_hint, requestMeta(req));
    return {};
  }

  @Post('oauth/introspect')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async introspect(@Req() req: Request) {
    const body = formBody(req);
    const { client } = await this.clientAuth.authenticate(req);
    if (client.type !== 'CONFIDENTIAL') {
      throw new OAuthError('invalid_client', 'Only confidential clients may introspect tokens', 401);
    }
    if (!body.token) throw new OAuthError('invalid_request', 'token is required');
    return this.tokens.introspect(body.token, body.token_type_hint);
  }

  @Get('oauth/logout')
  async endSession(@Query() query: Record<string, unknown>, @Req() req: Request, @Res() res: Response): Promise<void> {
    const pick = (k: string) => (typeof query[k] === 'string' ? query[k] : undefined);
    const params: LogoutParams = {
      id_token_hint: pick('id_token_hint'),
      post_logout_redirect_uri: pick('post_logout_redirect_uri'),
      client_id: pick('client_id'),
      state: pick('state'),
    };
    res.redirect(302, await this.logoutService.endSession(params, req, res, requestMeta(req)));
  }
}
