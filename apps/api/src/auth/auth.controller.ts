import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  mfaVerifySchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
  type CurrentUser,
  type LoginInput,
  type LoginResult,
  type MfaVerifyInput,
  type SignupInput,
} from '@gatekeeper/shared';
import type { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { cookieNames } from '../common/cookies';
import { requestMeta } from '../common/request';
import { ENV, type Env } from '../config/env';
import { LogoutService } from '../oauth/logout.service';
import { Auth, SessionGuard } from '../sessions/auth.guard';
import { SessionsService, type SessionWithUser } from '../sessions/sessions.service';
import { AuthService, toCurrentUser } from './auth.service';

const LIMIT_LOGIN = { default: { limit: 10, ttl: 60_000 } };
const LIMIT_SENSITIVE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Authentication (hosted login UI)')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly logoutService: LogoutService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('csrf')
  @ApiOperation({ summary: 'Issue the CSRF cookie and return its value (double-submit token)' })
  csrf(@Req() req: Request): { csrfToken: string } {
    const cookies = req.cookies as Record<string, string>;
    return { csrfToken: cookies[cookieNames(this.env).csrf] ?? '' };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Current user' })
  me(@Auth() session: SessionWithUser): CurrentUser {
    return toCurrentUser(session.user);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(LIMIT_LOGIN)
  @ApiOperation({ summary: 'Password login. Returns mfa_required when a second factor is needed.' })
  login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    return this.auth.login(body, req, res, requestMeta(req));
  }

  @Post('mfa')
  @HttpCode(200)
  @Throttle(LIMIT_LOGIN)
  @ApiOperation({ summary: 'Complete sign-in with a TOTP code or a recovery code' })
  mfa(
    @Body(new ZodPipe(mfaVerifySchema)) body: MfaVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    return this.auth.verifyMfa(body, req, res, requestMeta(req));
  }

  @Post('signup')
  @HttpCode(201)
  @Throttle(LIMIT_SENSITIVE)
  @ApiOperation({ summary: 'Create an account (a verification email is written to the outbox)' })
  signup(
    @Body(new ZodPipe(signupSchema)) body: SignupInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    return this.auth.signup(body, req, res, requestMeta(req));
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'End the session. Validates post_logout_redirect_uri for RP-initiated logout.' })
  async logout(
    @Body(new ZodPipe(logoutSchema)) body: z.infer<typeof logoutSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string | null }> {
    const session = await this.sessions.resolveAny(req);
    if (session)
      await this.logoutService.logout(
        session.id,
        session.userId,
        session.user.email,
        res,
        requestMeta(req),
        body.client_id,
      );
    else this.sessions.clearCookie(res);
    return { redirectTo: await this.logoutService.resolveRedirect(body) };
  }

  @Post('verify-email')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  async verifyEmail(
    @Body(new ZodPipe(verifyEmailSchema)) body: z.infer<typeof verifyEmailSchema>,
    @Req() req: Request,
  ) {
    await this.auth.verifyEmail(body.token, requestMeta(req));
    return { ok: true };
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  @UseGuards(SessionGuard)
  @ApiCookieAuth()
  async resend(@Auth() session: SessionWithUser) {
    await this.auth.sendVerification(session.user);
    return { ok: true };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  async forgot(
    @Body(new ZodPipe(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>,
    @Req() req: Request,
  ) {
    await this.auth.forgotPassword(body.email, requestMeta(req));
    return { ok: true };
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle(LIMIT_SENSITIVE)
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>, @Req() req: Request) {
    await this.auth.resetPassword(body.token, body.password, requestMeta(req));
    return { ok: true };
  }
}
