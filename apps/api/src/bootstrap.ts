import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { cookieNames } from './common/cookies';
import { publicCors } from './common/cors';
import { ENV, type Env } from './config/env';

function trustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/** Applies all HTTP-level configuration. Shared by main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const env = app.get<Env>(ENV);
  app.useLogger(app.get(Logger));
  app.set('trust proxy', trustProxy(env.TRUST_PROXY));
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
        },
      },
      hsts: env.COOKIE_SECURE ? { maxAge: 63072000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(publicCors);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(cookieParser());
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Gatekeeper API')
    .setDescription(
      'Management and self-service REST API of the Gatekeeper identity provider. ' +
        'Endpoints are authenticated with the session cookie set by `/api/auth/login`; ' +
        'state-changing requests must also send the `X-CSRF-Token` header (value of the CSRF cookie, see `GET /api/auth/csrf`). ' +
        'OAuth 2.1 / OIDC protocol endpoints are described by `/.well-known/openid-configuration`.',
    )
    .setVersion('1.0.0')
    .addCookieAuth(cookieNames(env).session)
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
    customSiteTitle: 'Gatekeeper API docs',
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
  });
  return app;
}
