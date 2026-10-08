import { CanActivate, ExecutionContext, HttpStatus, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/errors';
import { SessionsService, type SessionWithUser } from './sessions.service';

export type AuthedRequest = Request & { auth?: SessionWithUser };

/** Requires a fully authenticated (ACTIVE) session cookie. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const session = await this.sessions.resolve(req);
    if (!session) throw new ApiError(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Sign in to continue');
    req.auth = session;
    return true;
  }
}

/** Requires an ACTIVE session belonging to a user with the ADMIN role. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const session = await this.sessions.resolve(req);
    if (!session) throw new ApiError(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Sign in to continue');
    if (!session.user.roles.includes('ADMIN')) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'forbidden', 'Administrator role required');
    }
    req.auth = session;
    return true;
  }
}

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionWithUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new ApiError(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Sign in to continue');
  return req.auth;
});
