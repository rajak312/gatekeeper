import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CurrentUser, LoginInput, LoginResult, MfaVerifyInput, SignupInput } from '@gatekeeper/shared';
import { ENV, type Env } from '../config/env';
import { randomToken, sha256 } from '../common/crypto';
import { ApiError } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mailer';
import { MfaService } from '../mfa/mfa.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { PasswordService } from '../users/password.service';
import { assertNotProtected } from '../users/demo-guard';
import type { User } from '../generated/prisma/client';

const MAX_MFA_ATTEMPTS = 5;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

export function toCurrentUser(user: User): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: Boolean(user.emailVerifiedAt),
    roles: user.roles,
    mfaEnabled: Boolean(user.totpEnabledAt),
    createdAt: user.createdAt.toISOString(),
    isProtected: user.isProtected,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private afterLogin(interaction?: string): string {
    return interaction ? `/oauth/authorize/resume?interaction=${encodeURIComponent(interaction)}` : '/account';
  }

  private invalidCredentials(): ApiError {
    return new ApiError(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'Incorrect email or password');
  }

  async login(input: LoginInput, req: Request, res: Response, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record({
        type: 'user.login_failed',
        success: false,
        actorEmail: input.email,
        meta,
        metadata: { reason: 'unknown_user' },
      });
      throw this.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record({
        type: 'user.login_failed',
        success: false,
        actorId: user.id,
        actorEmail: user.email,
        meta,
        metadata: { reason: 'locked' },
      });
      const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'account_locked',
        `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        { retryAfter },
      );
    }

    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      await this.registerFailure(user, meta);
      throw this.invalidCredentials();
    }

    if (user.disabledAt) {
      await this.audit.record({
        type: 'user.login_failed',
        success: false,
        actorId: user.id,
        actorEmail: user.email,
        meta,
        metadata: { reason: 'disabled' },
      });
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'account_disabled',
        'This account has been disabled by an administrator',
      );
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }

    // Replace any existing session on this browser (prevents session fixation / stacking).
    const previous = await this.sessions.resolveAny(req);
    if (previous) await this.sessions.revoke({ id: previous.id });

    if (user.totpEnabledAt) {
      await this.sessions.create(res, user.id, { pendingMfa: true, amr: ['pwd'], meta });
      const mfaUrl = input.interaction ? `/mfa?interaction=${encodeURIComponent(input.interaction)}` : '/mfa';
      return { status: 'mfa_required', redirectTo: mfaUrl };
    }

    await this.sessions.create(res, user.id, { pendingMfa: false, amr: ['pwd'], meta });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      type: 'user.login',
      actorId: user.id,
      actorEmail: user.email,
      meta,
      metadata: { amr: ['pwd'] },
    });
    return { status: 'authenticated', redirectTo: this.afterLogin(input.interaction) };
  }

  /**
   * Counts a failed password attempt; after LOGIN_MAX_FAILURES the account is
   * locked for LOGIN_LOCKOUT_SECONDS. (Per-IP rate limiting is handled by the
   * throttler.) Shared demo accounts are exempt in DEMO_MODE so one visitor
   * can't lock everyone else out.
   */
  private async registerFailure(user: User, meta: RequestMeta): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    await this.audit.record({
      type: 'user.login_failed',
      success: false,
      actorId: user.id,
      actorEmail: user.email,
      meta,
      metadata: { reason: 'bad_password', failures: updated.failedLoginCount },
    });
    const exempt = this.env.DEMO_MODE && user.isProtected;
    if (!exempt && updated.failedLoginCount >= this.env.LOGIN_MAX_FAILURES) {
      const lockedUntil = new Date(Date.now() + this.env.LOGIN_LOCKOUT_SECONDS * 1000);
      await this.prisma.user.update({ where: { id: user.id }, data: { lockedUntil, failedLoginCount: 0 } });
      await this.audit.record({
        type: 'user.locked',
        success: false,
        actorId: user.id,
        actorEmail: user.email,
        meta,
        metadata: { until: lockedUntil.toISOString(), reason: 'too_many_failures' },
      });
    }
  }

  async verifyMfa(input: MfaVerifyInput, req: Request, res: Response, meta: RequestMeta): Promise<LoginResult> {
    const pending = await this.sessions.resolvePendingMfa(req);
    if (!pending) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'mfa_session_expired',
        'Your sign-in attempt expired. Please sign in again.',
      );
    }
    const user = pending.user;
    const ok = input.code
      ? await this.mfa.verifyCode(user, input.code)
      : await this.mfa.useRecoveryCode(user, input.recoveryCode!);

    if (!ok) {
      const { mfaAttempts } = await this.prisma.session.update({
        where: { id: pending.id },
        data: { mfaAttempts: { increment: 1 } },
      });
      await this.audit.record({
        type: 'mfa.failed',
        success: false,
        actorId: user.id,
        actorEmail: user.email,
        meta,
        metadata: { attempts: mfaAttempts },
      });
      if (mfaAttempts >= MAX_MFA_ATTEMPTS) {
        await this.sessions.revoke({ id: pending.id });
        this.sessions.clearCookie(res);
        throw new ApiError(
          HttpStatus.UNAUTHORIZED,
          'mfa_session_expired',
          'Too many invalid codes. Please sign in again.',
        );
      }
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'invalid_code',
        input.code ? 'Invalid or already used code' : 'Invalid recovery code',
      );
    }

    const amr = input.code ? ['pwd', 'otp', 'mfa'] : ['pwd', 'mfa'];
    await this.sessions.activate(res, pending.id, amr);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    if (input.recoveryCode) {
      await this.audit.record({
        type: 'mfa.recovery_code_used',
        actorId: user.id,
        actorEmail: user.email,
        meta,
        metadata: { remaining: await this.mfa.remainingRecoveryCodes(user.id) },
      });
    } else {
      await this.audit.record({ type: 'mfa.verified', actorId: user.id, actorEmail: user.email, meta });
    }
    await this.audit.record({ type: 'user.login', actorId: user.id, actorEmail: user.email, meta, metadata: { amr } });
    return { status: 'authenticated', redirectTo: this.afterLogin(input.interaction) };
  }

  async signup(input: SignupInput, req: Request, res: Response, meta: RequestMeta): Promise<LoginResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'email_taken',
        'An account with this email already exists. Try signing in instead.',
      );
    }
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await this.passwords.hash(input.password),
        lastLoginAt: new Date(),
      },
    });
    await this.sendVerification(user);
    const previous = await this.sessions.resolveAny(req);
    if (previous) await this.sessions.revoke({ id: previous.id });
    await this.sessions.create(res, user.id, { pendingMfa: false, amr: ['pwd'], meta });
    await this.audit.record({ type: 'user.signup', actorId: user.id, actorEmail: user.email, meta });
    return { status: 'authenticated', redirectTo: this.afterLogin(input.interaction) };
  }

  async sendVerification(user: User): Promise<void> {
    if (user.emailVerifiedAt) return;
    const token = randomToken(32);
    await this.prisma.emailToken.create({
      data: {
        userId: user.id,
        type: 'VERIFY_EMAIL',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
      },
    });
    await this.mail.sendEmailVerification(user.email, user.name, token);
  }

  private async consumeEmailToken(token: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    const record = await this.prisma.emailToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!record || record.type !== type || record.usedAt || record.expiresAt <= new Date()) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_token', 'This link is invalid or has expired');
    }
    const { count } = await this.prisma.emailToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_token', 'This link has already been used');
    return record;
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    const record = await this.consumeEmailToken(token, 'VERIFY_EMAIL');
    await this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.record({
      type: 'user.email_verified',
      actorId: record.userId,
      actorEmail: record.user.email,
      meta,
    });
  }

  /** Always succeeds, so the response can't be used to discover registered emails. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    await this.audit.record({
      type: 'user.password_reset_requested',
      actorId: user?.id ?? null,
      actorEmail: email,
      meta,
      metadata: { known: Boolean(user) },
    });
    if (!user || user.disabledAt || (this.env.DEMO_MODE && user.isProtected)) return;
    const token = randomToken(32);
    await this.prisma.emailToken.create({
      data: {
        userId: user.id,
        type: 'RESET_PASSWORD',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    await this.mail.sendPasswordReset(user.email, user.name, token);
  }

  /** Resets the password and signs the user out everywhere (sessions + all grants). */
  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const record = await this.consumeEmailToken(token, 'RESET_PASSWORD');
    assertNotProtected(this.env, record.user, 'This account');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await this.passwords.hash(password), failedLoginCount: 0, lockedUntil: null },
    });
    await this.revokeEverything(record.userId);
    await this.audit.record({
      type: 'user.password_reset',
      actorId: record.userId,
      actorEmail: record.user.email,
      meta,
    });
  }

  async revokeEverything(userId: string, exceptSessionId?: string): Promise<void> {
    await this.sessions.revoke({ userId, excludeId: exceptSessionId });
    const now = new Date();
    const grants = await this.prisma.grant.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    const ids = grants.map((g) => g.id);
    await this.prisma.$transaction([
      this.prisma.grant.updateMany({
        where: { id: { in: ids } },
        data: { revokedAt: now, revokedReason: 'credentials_changed' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { grantId: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.accessToken.updateMany({
        where: { grantId: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }
}
