import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  changePasswordSchema,
  mfaActivateSchema,
  mfaDisableSchema,
  mfaRegenerateSchema,
  updateProfileSchema,
  type AuditEventInfo,
  type AuthorizedApp,
  type CurrentUser,
  type MfaSetupResponse,
  type SessionInfo,
} from '@gatekeeper/shared';
import { ENV, type Env } from '../config/env';
import { ApiError } from '../common/errors';
import { requestMeta } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { AuthService, toCurrentUser } from '../auth/auth.service';
import { MfaService } from '../mfa/mfa.service';
import { PrismaService } from '../prisma/prisma.service';
import { Auth, SessionGuard } from '../sessions/auth.guard';
import { SessionsService, type SessionWithUser } from '../sessions/sessions.service';
import { PasswordService } from '../users/password.service';
import { assertNotProtected } from '../users/demo-guard';
import { toAuditInfo, toSessionInfo } from '../admin/mappers';

const LIMIT_SENSITIVE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Account (self-service)')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Controller('api/account')
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Patch('profile')
  @ApiOperation({ summary: 'Update display name' })
  async updateProfile(
    @Auth() s: SessionWithUser,
    @Body(new ZodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
    @Req() req: Request,
  ): Promise<CurrentUser> {
    assertNotProtected(this.env, s.user, 'The demo account');
    const user = await this.prisma.user.update({ where: { id: s.userId }, data: { name: body.name } });
    await this.audit.record({
      type: 'user.updated',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
    });
    return toCurrentUser(user);
  }

  @Post('password')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  @ApiOperation({ summary: 'Change password (signs out all other sessions and revokes tokens)' })
  async changePassword(
    @Auth() s: SessionWithUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: Request,
  ) {
    assertNotProtected(this.env, s.user, 'The demo account');
    if (!(await this.passwords.verify(s.user.passwordHash, body.currentPassword))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_password', 'Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: s.userId },
      data: { passwordHash: await this.passwords.hash(body.newPassword) },
    });
    await this.auth.revokeEverything(s.userId, s.id);
    await this.audit.record({
      type: 'user.password_changed',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ sessions

  @Get('sessions')
  @ApiOperation({ summary: 'Active sessions for the current user' })
  async listSessions(@Auth() s: SessionWithUser): Promise<SessionInfo[]> {
    const rows = await this.sessions.listForUser(s.userId);
    return rows.map((r) => toSessionInfo(r, s.id));
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Revoke one of your sessions' })
  async revokeSession(
    @Auth() s: SessionWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const target = await this.prisma.session.findFirst({ where: { id, userId: s.userId } });
    if (!target) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found', 'Session not found');
    await this.sessions.revoke({ id });
    if (id === s.id) this.sessions.clearCookie(res);
    await this.audit.record({
      type: 'session.revoked',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
      metadata: { sessionId: id },
    });
    return { ok: true };
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out everywhere else' })
  async revokeOthers(@Auth() s: SessionWithUser, @Req() req: Request) {
    const count = await this.sessions.revoke({ userId: s.userId, excludeId: s.id });
    await this.audit.record({
      type: 'session.revoked',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
      metadata: { count, others: true },
    });
    return { revoked: count };
  }

  // ------------------------------------------------------------------ connected apps

  @Get('apps')
  @ApiOperation({ summary: 'Applications you have granted access to' })
  async apps(@Auth() s: SessionWithUser): Promise<AuthorizedApp[]> {
    const consents = await this.prisma.consent.findMany({
      where: { userId: s.userId },
      include: { client: true },
      orderBy: { updatedAt: 'desc' },
    });
    return consents.map((c) => ({
      clientId: c.client.clientId,
      name: c.client.name,
      scopes: c.scopes,
      grantedAt: c.updatedAt.toISOString(),
    }));
  }

  @Delete('apps/:clientId')
  @ApiOperation({ summary: 'Revoke consent and every token issued to an application' })
  async revokeApp(@Auth() s: SessionWithUser, @Param('clientId') clientId: string, @Req() req: Request) {
    const client = await this.prisma.client.findUnique({ where: { clientId } });
    if (!client) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found', 'Application not found');
    const now = new Date();
    const grants = await this.prisma.grant.findMany({
      where: { userId: s.userId, clientId: client.id, revokedAt: null },
      select: { id: true },
    });
    const ids = grants.map((g) => g.id);
    await this.prisma.$transaction([
      this.prisma.consent.deleteMany({ where: { userId: s.userId, clientId: client.id } }),
      this.prisma.grant.updateMany({
        where: { id: { in: ids } },
        data: { revokedAt: now, revokedReason: 'consent_revoked' },
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
    await this.audit.record({
      type: 'consent.revoked',
      actorId: s.userId,
      actorEmail: s.user.email,
      clientId,
      meta: requestMeta(req),
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ MFA

  @Get('mfa')
  @ApiOperation({ summary: 'MFA status' })
  async mfaStatus(@Auth() s: SessionWithUser) {
    return {
      enabled: Boolean(s.user.totpEnabledAt),
      enabledAt: s.user.totpEnabledAt?.toISOString() ?? null,
      recoveryCodesRemaining: s.user.totpEnabledAt ? await this.mfa.remainingRecoveryCodes(s.userId) : 0,
    };
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  @ApiOperation({ summary: 'Begin TOTP enrollment: returns secret, otpauth:// URL and QR code' })
  setupMfa(@Auth() s: SessionWithUser): Promise<MfaSetupResponse> {
    assertNotProtected(this.env, s.user, 'The demo account');
    return this.mfa.beginEnrollment(s.user);
  }

  @Post('mfa/activate')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  @ApiOperation({ summary: 'Confirm enrollment with a code; returns one-time recovery codes' })
  async activateMfa(
    @Auth() s: SessionWithUser,
    @Body(new ZodPipe(mfaActivateSchema)) body: z.infer<typeof mfaActivateSchema>,
    @Req() req: Request,
  ) {
    assertNotProtected(this.env, s.user, 'The demo account');
    const recoveryCodes = await this.mfa.activate(s.user, body.code);
    await this.audit.record({
      type: 'mfa.enrolled',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
    });
    return { recoveryCodes };
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  @ApiOperation({ summary: 'Disable MFA (requires password and a current code)' })
  async disableMfa(
    @Auth() s: SessionWithUser,
    @Body(new ZodPipe(mfaDisableSchema)) body: z.infer<typeof mfaDisableSchema>,
    @Req() req: Request,
  ) {
    const passwordOk = await this.passwords.verify(s.user.passwordHash, body.password);
    const codeOk = passwordOk && (await this.mfa.verifyCode(s.user, body.code));
    if (!codeOk) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_credentials', 'Password or code is incorrect');
    await this.mfa.disable(s.userId);
    await this.audit.record({
      type: 'mfa.disabled',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
    });
    return { ok: true };
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  @ApiOperation({ summary: 'Regenerate recovery codes (invalidates the old ones)' })
  async regenerate(
    @Auth() s: SessionWithUser,
    @Body(new ZodPipe(mfaRegenerateSchema)) body: z.infer<typeof mfaRegenerateSchema>,
    @Req() req: Request,
  ) {
    if (!(await this.mfa.verifyCode(s.user, body.code))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_code', 'Invalid or already used code');
    }
    const recoveryCodes = await this.mfa.regenerateRecoveryCodes(s.user);
    await this.audit.record({
      type: 'mfa.recovery_codes_regenerated',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
    });
    return { recoveryCodes };
  }

  // ------------------------------------------------------------------ activity

  @Get('activity')
  @ApiOperation({ summary: 'Recent security events for your account' })
  async activity(@Auth() s: SessionWithUser): Promise<AuditEventInfo[]> {
    const events = await this.prisma.auditEvent.findMany({
      where: { OR: [{ actorId: s.userId }, { subjectId: s.userId }] },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return events.map(toAuditInfo);
  }
}
