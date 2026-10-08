import type { NextFunction, Request, Response } from 'express';

/**
 * Protocol endpoints that browser-based (public) clients call directly get a
 * permissive, credential-less CORS policy. Cookie-authenticated /api/* routes
 * deliberately get no CORS headers at all.
 */
const PUBLIC_PATHS = [/^\/\.well-known\//, /^\/oauth\/(token|userinfo|revoke|introspect|jwks)$/];

export function publicCors(req: Request, res: Response, next: NextFunction): void {
  if (!PUBLIC_PATHS.some((re) => re.test(req.path))) return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
