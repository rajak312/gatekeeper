import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env';

/**
 * Cookie names. When cookies are Secure we use the `__Host-` prefix, which
 * browsers only accept with Secure, Path=/ and no Domain attribute - so the
 * cookie can't be set or shadowed by another (sub)domain.
 */
export function cookieNames(env: Env) {
  const prefix = env.COOKIE_SECURE ? '__Host-' : '';
  return { session: `${prefix}gk_session`, csrf: `${prefix}gk_csrf` } as const;
}

export function sessionCookieOptions(env: Env, maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    // Lax (not Strict): the session must be sent on the top-level GET navigation
    // from a relying party to /oauth/authorize, otherwise SSO would never work.
    // Cross-site POSTs (CSRF) still don't carry it.
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}

export function csrfCookieOptions(env: Env): CookieOptions {
  return { httpOnly: false, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/' };
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(cookieNames(env).session, { ...sessionCookieOptions(env, 0), maxAge: undefined });
}
