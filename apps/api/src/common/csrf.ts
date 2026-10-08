import { HttpStatus, Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ENV, type Env } from '../config/env';
import { randomToken, safeEqual } from './crypto';
import { cookieNames, csrfCookieOptions } from './cookies';
import { ApiError } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated JSON endpoints (/api/*):
 *  1. Double-submit token: a random `gk_csrf` cookie (SameSite=Strict, `__Host-`
 *     prefixed in production so it can't be planted) must be echoed in the
 *     `X-CSRF-Token` header. Cross-origin pages can't read the cookie, and a
 *     custom header forces a CORS preflight that /api/* never approves.
 *  2. Origin check: if the browser sends Origin, it must be the web app's origin.
 * Plus the session cookie itself is SameSite=Lax.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly allowedOrigins: Set<string>;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.allowedOrigins = new Set([new URL(env.WEB_URL).origin, new URL(env.ISSUER_URL).origin]);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const names = cookieNames(this.env);
    const cookies = req.cookies as Record<string, string | undefined>;
    let cookieToken = cookies[names.csrf];
    if (!cookieToken) {
      cookieToken = randomToken(24);
      res.cookie(names.csrf, cookieToken, csrfCookieOptions(this.env));
      // Make the token usable within this same request cycle (e.g. GET /api/auth/csrf).
      cookies[names.csrf] = cookieToken;
    }

    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.headers.origin;
    if (origin && !this.allowedOrigins.has(origin)) {
      return next(new ApiError(HttpStatus.FORBIDDEN, 'csrf_origin', 'Cross-origin request blocked'));
    }
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || !safeEqual(header, cookieToken)) {
      return next(new ApiError(HttpStatus.FORBIDDEN, 'csrf_token', 'Missing or invalid CSRF token'));
    }
    next();
  }
}
