import type { Params } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import type { Env } from '../config/env';

/** Query parameters whose values must never reach the logs. */
const SENSITIVE_QUERY = new Set([
  'code',
  'token',
  'id_token_hint',
  'refresh_token',
  'access_token',
  'client_secret',
  'code_verifier',
  'interaction',
]);

export function redactUrl(url: string | undefined): string | undefined {
  if (!url || !url.includes('?')) return url;
  const [path, query] = url.split('?', 2) as [string, string];
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY.has(key)) params.set(key, '[redacted]');
  }
  return `${path}?${params.toString()}`;
}

export function loggerOptions(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      // Never log credentials: auth headers, cookies, or Set-Cookie.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: IncomingMessage & { id?: unknown; raw?: IncomingMessage }) => ({
          id: req.id,
          method: req.method,
          url: redactUrl(req.url),
        }),
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    },
  };
}
