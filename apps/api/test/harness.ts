import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DEMO_ADMIN, DEMO_USER, seedDatabase } from '../src/demo/seed';
import { PrismaService } from '../src/prisma/prisma.service';
import { totp } from '../src/mfa/totp';

export const WEB = 'http://localhost:3500';
export const PLAYGROUND_REDIRECT = `${WEB}/playground/callback`;
export { DEMO_ADMIN, DEMO_USER };

export type Agent = ReturnType<typeof request.agent>;

export interface Harness {
  app: NestExpressApplication;
  prisma: PrismaService;
  agent: () => Agent;
  close: () => Promise<void>;
}

const TABLES = [
  'AccessToken',
  'RefreshToken',
  'Grant',
  'AuthorizationCode',
  'Interaction',
  'Consent',
  'UserClientRole',
  'ClientRole',
  'RecoveryCode',
  'Session',
  'EmailToken',
  'OutboxEmail',
  'AuditEvent',
  'SigningKey',
  'Client',
  'Scope',
  'User',
];

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  // Listen on an ephemeral port so supertest reuses one server instead of spawning one per request.
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
  await seedDatabase(prisma, { webUrl: WEB });
  return {
    app,
    prisma,
    agent: () => request.agent(app.getHttpServer()),
    close: () => app.close(),
  };
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export async function csrf(agent: Agent): Promise<string> {
  const res = await agent.get('/api/auth/csrf').expect(200);
  return (res.body as { csrfToken: string }).csrfToken;
}

type Res = Awaited<ReturnType<Agent['get']>>;

/** Awaitable request that also supports `.expect(status)` like supertest. */
function withExpect(p: Promise<Res>): Promise<Res> & { expect: (status: number) => Promise<Res> } {
  return Object.assign(p, {
    expect: async (status: number) => {
      const res = await p;
      if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
      return res;
    },
  });
}

export function login(agent: Agent, email: string, password: string, interaction?: string) {
  return withExpect(
    (async () => {
      const token = await csrf(agent);
      return agent.post('/api/auth/login').set('x-csrf-token', token).send({ email, password, interaction });
    })(),
  );
}

export function location(res: { headers: Record<string, string | string[] | undefined> }): URL {
  const loc = res.headers.location;
  if (typeof loc !== 'string') throw new Error('Expected a redirect');
  return new URL(loc, WEB);
}

export interface AuthorizeOptions {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  nonce?: string;
  challenge: string;
  prompt?: string;
  extra?: Record<string, string>;
}

export function authorizeQuery(o: AuthorizeOptions): Record<string, string> {
  return {
    response_type: 'code',
    client_id: o.clientId ?? 'playground',
    redirect_uri: o.redirectUri ?? PLAYGROUND_REDIRECT,
    scope: o.scope ?? 'openid profile email offline_access',
    state: o.state ?? 'state-xyz',
    nonce: o.nonce ?? 'nonce-abc',
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    ...(o.prompt ? { prompt: o.prompt } : {}),
    ...(o.extra ?? {}),
  };
}

/**
 * Drives the full browser side of the Authorization Code flow:
 * /oauth/authorize -> login -> resume -> consent -> redirect with ?code.
 */
export async function runAuthorizationFlow(
  agent: Agent,
  opts: AuthorizeOptions & { email?: string; password?: string; consent?: 'allow' | 'deny' },
): Promise<URL> {
  let res = await agent.get('/oauth/authorize').query(authorizeQuery(opts)).expect(302);
  let loc = location(res);

  if (loc.pathname === '/login') {
    const interaction = loc.searchParams.get('interaction')!;
    const loginRes = await login(
      agent,
      opts.email ?? DEMO_USER.email,
      opts.password ?? DEMO_USER.password,
      interaction,
    ).expect(200);
    res = await agent.get((loginRes.body as { redirectTo: string }).redirectTo).expect(302);
    loc = location(res);
  }
  if (loc.pathname === '/consent') {
    const interaction = loc.searchParams.get('interaction')!;
    const token = await csrf(agent);
    const consent = await agent
      .post(`/api/interactions/${interaction}/consent`)
      .set('x-csrf-token', token)
      .send({ decision: opts.consent ?? 'allow', remember: true })
      .expect(200);
    loc = new URL((consent.body as { redirectTo: string }).redirectTo);
  }
  return loc;
}

export function exchangeCode(agent: Agent, code: string, verifier: string, extra: Record<string, string> = {}) {
  return agent
    .post('/oauth/token')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: 'playground',
      code,
      redirect_uri: PLAYGROUND_REDIRECT,
      code_verifier: verifier,
      ...extra,
    });
}

/** Full flow returning a token response for the demo user. */
export async function obtainTokens(agent: Agent, scope = 'openid profile email offline_access') {
  const { verifier, challenge } = pkcePair();
  const loc = await runAuthorizationFlow(agent, { challenge, scope });
  const code = loc.searchParams.get('code')!;
  const res = await exchangeCode(agent, code, verifier).expect(200);
  return res.body as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    scope: string;
    expires_in: number;
  };
}

export function currentTotp(secret: string, offsetSteps = 0): string {
  return totp(secret, Date.now() + offsetSteps * 30_000);
}
