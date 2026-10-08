import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ENV, type Env } from '../config/env';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { JwtService } from '../keys/jwt.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { buildRedirect } from './redirect-uri';

export interface LogoutParams {
  id_token_hint?: string;
  post_logout_redirect_uri?: string;
  client_id?: string;
  state?: string;
}

/** OpenID Connect RP-Initiated Logout 1.0. */
@Injectable()
export class LogoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async hintSubject(hint: string | undefined): Promise<{ sub?: string; aud?: string } | null> {
    if (!hint) return null;
    try {
      const payload = await this.jwt.verify(hint, { allowExpired: true });
      const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
      return { sub: payload.sub, aud };
    } catch {
      return null;
    }
  }

  /**
   * Resolves where to send the browser after logout. The redirect URI is only
   * honoured if it is registered for the identified client.
   */
  async resolveRedirect(params: LogoutParams, hintAud?: string): Promise<string | null> {
    const clientId = params.client_id ?? hintAud;
    if (!params.post_logout_redirect_uri || !clientId) return null;
    if (params.client_id && hintAud && params.client_id !== hintAud) return null;
    const client = await this.prisma.client.findUnique({ where: { clientId } });
    if (!client || !client.postLogoutRedirectUris.includes(params.post_logout_redirect_uri)) return null;
    return buildRedirect(params.post_logout_redirect_uri, { state: params.state });
  }

  /** GET /oauth/logout */
  async endSession(params: LogoutParams, req: Request, res: Response, meta: RequestMeta): Promise<string> {
    const hint = await this.hintSubject(params.id_token_hint);
    const target = await this.resolveRedirect(params, hint?.aud);
    const session = await this.sessions.resolve(req);
    const loggedOutPage = `${this.env.WEB_URL}/logout?done=1`;

    if (!session) return target ?? loggedOutPage;

    if (hint?.sub && hint.sub === session.userId) {
      // A valid id_token_hint for the current user proves the RP initiated this: log out directly.
      await this.logout(session.id, session.userId, session.user.email, res, meta, hint.aud);
      return target ?? loggedOutPage;
    }

    // Otherwise ask the user to confirm, to prevent drive-by logout (logout CSRF).
    const confirm = new URL('/logout', this.env.WEB_URL);
    for (const k of ['post_logout_redirect_uri', 'client_id', 'state'] as const) {
      const v = params[k] ?? (k === 'client_id' ? hint?.aud : undefined);
      if (v) confirm.searchParams.set(k, v);
    }
    return confirm.toString();
  }

  async logout(
    sessionId: string,
    userId: string,
    email: string,
    res: Response,
    meta: RequestMeta,
    clientId?: string,
  ): Promise<void> {
    await this.sessions.revoke({ id: sessionId });
    this.sessions.clearCookie(res);
    await this.audit.record({
      type: 'user.logout',
      actorId: userId,
      actorEmail: email,
      clientId: clientId ?? null,
      meta,
    });
  }
}
