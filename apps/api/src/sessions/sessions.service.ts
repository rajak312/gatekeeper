import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ENV, type Env } from '../config/env';
import { randomToken, sha256 } from '../common/crypto';
import { cookieNames, clearSessionCookie, sessionCookieOptions } from '../common/cookies';
import type { RequestMeta } from '../common/request';
import { PrismaService } from '../prisma/prisma.service';
import type { Session, User } from '../generated/prisma/client';

export type SessionWithUser = Session & { user: User };

const PENDING_MFA_TTL_SECONDS = 5 * 60;
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Creates a session and sets the cookie. Only the SHA-256 of the token is stored. */
  async create(
    res: Response,
    userId: string,
    opts: { pendingMfa: boolean; amr: string[]; meta: RequestMeta },
  ): Promise<Session> {
    const token = randomToken(32);
    const ttl = opts.pendingMfa ? PENDING_MFA_TTL_SECONDS : this.env.SESSION_TTL;
    const now = new Date();
    const session = await this.prisma.session.create({
      data: {
        tokenHash: sha256(token),
        userId,
        status: opts.pendingMfa ? 'PENDING_MFA' : 'ACTIVE',
        amr: opts.amr,
        authTime: opts.pendingMfa ? null : now,
        ip: opts.meta.ip,
        userAgent: opts.meta.userAgent,
        expiresAt: new Date(now.getTime() + ttl * 1000),
      },
    });
    res.cookie(cookieNames(this.env).session, token, sessionCookieOptions(this.env, ttl));
    return session;
  }

  /** Promotes a PENDING_MFA session to ACTIVE after a successful second factor. */
  async activate(res: Response, sessionId: string, amr: string[]): Promise<Session> {
    // Rotate the session token on privilege change to prevent session fixation.
    const token = randomToken(32);
    const now = new Date();
    const session = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        tokenHash: sha256(token),
        status: 'ACTIVE',
        amr,
        authTime: now,
        expiresAt: new Date(now.getTime() + this.env.SESSION_TTL * 1000),
      },
    });
    res.cookie(cookieNames(this.env).session, token, sessionCookieOptions(this.env, this.env.SESSION_TTL));
    return session;
  }

  private tokenFrom(req: Request): string | null {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const value = cookies?.[cookieNames(this.env).session];
    return typeof value === 'string' && value.length > 20 && value.length < 200 ? value : null;
  }

  /** Resolves the request's session (any status) if it is valid and unexpired. */
  async resolveAny(req: Request): Promise<SessionWithUser | null> {
    const token = this.tokenFrom(req);
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabledAt) return null;
    return session;
  }

  /** Resolves a fully-authenticated session, touching lastSeenAt periodically. */
  async resolve(req: Request): Promise<SessionWithUser | null> {
    const session = await this.resolveAny(req);
    if (!session || session.status !== 'ACTIVE') return null;
    if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return session;
  }

  async resolvePendingMfa(req: Request): Promise<SessionWithUser | null> {
    const session = await this.resolveAny(req);
    return session?.status === 'PENDING_MFA' ? session : null;
  }

  clearCookie(res: Response): void {
    clearSessionCookie(res, this.env);
  }

  /**
   * Revokes sessions. Grants that were bound to the session and did not obtain
   * offline access (no refresh token) are revoked too: logging out should end
   * the SSO session's access tokens, while offline grants survive by design.
   */
  async revoke(where: { id?: string; userId?: string; excludeId?: string }): Promise<number> {
    const sessions = await this.prisma.session.findMany({
      where: {
        revokedAt: null,
        ...(where.id ? { id: where.id } : {}),
        ...(where.userId ? { userId: where.userId } : {}),
        ...(where.excludeId ? { NOT: { id: where.excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!sessions.length) return 0;
    const ids = sessions.map((s) => s.id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.session.updateMany({ where: { id: { in: ids } }, data: { revokedAt: now } }),
      this.prisma.grant.updateMany({
        where: { sessionId: { in: ids }, revokedAt: null, NOT: { scopes: { has: 'offline_access' } } },
        data: { revokedAt: now, revokedReason: 'session_ended' },
      }),
    ]);
    return ids.length;
  }

  async listForUser(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, status: 'ACTIVE', revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
