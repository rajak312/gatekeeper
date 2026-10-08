import { hash } from '@node-rs/argon2';
import type { PrismaClient } from '../generated/prisma/client';
import { sha256 } from '../common/crypto';

/** Documented demo credentials (also listed in the README and on the login page in DEMO_MODE). */
export const DEMO_ADMIN = { email: 'admin@gatekeeper.dev', password: 'admin1234', name: 'Ada Admin' } as const;
export const DEMO_USER = { email: 'demo@gatekeeper.dev', password: 'demo1234', name: 'Dana Demo' } as const;
/** Demo-only secret for the seeded confidential client (try client_credentials with curl). */
export const DEMO_SERVICE_CLIENT = {
  clientId: 'acme-reports',
  secret: 'gks_demo_acme_reports_secret_change_me',
} as const;
export const PLAYGROUND_CLIENT_ID = 'playground';

const SYSTEM_SCOPES: [string, string][] = [
  ['openid', 'Sign you in with your Gatekeeper account'],
  ['profile', 'See your name and basic profile information'],
  ['email', 'See your email address'],
  ['offline_access', 'Stay signed in and access your data while you are away'],
];

const CUSTOM_SCOPES: [string, string][] = [
  ['roles', 'See your roles and permissions'],
  ['api:read', 'Read data from the Acme API on your behalf'],
  ['api:write', 'Create and modify data in the Acme API on your behalf'],
];

const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export interface SeedOptions {
  webUrl: string;
  /** Delete visitor-created data and restore demo fixtures. */
  reset?: boolean;
  /** Generate synthetic login history so the dashboard chart isn't empty on a fresh deploy. */
  syntheticHistory?: boolean;
  log?: (msg: string) => void;
}

export async function seedDatabase(prisma: PrismaClient, opts: SeedOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);
  const web = opts.webUrl.replace(/\/+$/, '');

  if (opts.reset) {
    log('Resetting demo data');
    await prisma.$transaction([
      prisma.interaction.deleteMany({}),
      prisma.authorizationCode.deleteMany({}),
      prisma.user.deleteMany({ where: { isProtected: false } }),
      prisma.client.deleteMany({
        where: { clientId: { notIn: [PLAYGROUND_CLIENT_ID, DEMO_SERVICE_CLIENT.clientId] } },
      }),
      prisma.scope.deleteMany({ where: { name: { notIn: [...SYSTEM_SCOPES, ...CUSTOM_SCOPES].map(([n]) => n) } } }),
      prisma.outboxEmail.deleteMany({}),
      prisma.emailToken.deleteMany({}),
      prisma.auditEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } }),
    ]);
  }

  for (const [name, description] of SYSTEM_SCOPES) {
    await prisma.scope.upsert({
      where: { name },
      create: { name, description, isSystem: true },
      update: { description, isSystem: true },
    });
  }
  for (const [name, description] of CUSTOM_SCOPES) {
    await prisma.scope.upsert({ where: { name }, create: { name, description }, update: { description } });
  }

  const upsertUser = async (u: { email: string; password: string; name: string }, roles: ('ADMIN' | 'USER')[]) => {
    const passwordHash = await hash(u.password, ARGON2);
    const reset = {
      name: u.name,
      passwordHash,
      roles,
      emailVerifiedAt: new Date(),
      disabledAt: null,
      disabledReason: null,
      failedLoginCount: 0,
      lockedUntil: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      isProtected: true,
    };
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing && !opts.reset) return existing;
    return prisma.user.upsert({ where: { email: u.email }, create: { email: u.email, ...reset }, update: reset });
  };
  const admin = await upsertUser(DEMO_ADMIN, ['ADMIN', 'USER']);
  const demo = await upsertUser(DEMO_USER, ['USER']);

  const playgroundData = {
    name: 'OAuth Playground',
    description: 'Built-in demo single-page app that signs in with Authorization Code + PKCE.',
    type: 'PUBLIC' as const,
    redirectUris: [...new Set([`${web}/playground/callback`, 'http://localhost:3500/playground/callback'])],
    postLogoutRedirectUris: [...new Set([`${web}/playground`, 'http://localhost:3500/playground'])],
    allowedScopes: ['openid', 'profile', 'email', 'offline_access', 'roles', 'api:read', 'api:write'],
    grantTypes: ['authorization_code', 'refresh_token'],
    requireConsent: true,
    accessTokenTtl: 600,
    refreshTokenTtl: 60 * 60 * 24,
    isProtected: true,
    disabledAt: null,
  };
  const playground = await prisma.client.upsert({
    where: { clientId: PLAYGROUND_CLIENT_ID },
    create: { clientId: PLAYGROUND_CLIENT_ID, ...playgroundData },
    update: playgroundData,
  });

  const serviceData = {
    name: 'Acme Reports (service)',
    description: 'Machine-to-machine client using the client_credentials grant.',
    type: 'CONFIDENTIAL' as const,
    secretHash: sha256(DEMO_SERVICE_CLIENT.secret),
    secretHint: DEMO_SERVICE_CLIENT.secret.slice(-4),
    redirectUris: [],
    postLogoutRedirectUris: [],
    allowedScopes: ['api:read'],
    grantTypes: ['client_credentials'],
    requireConsent: false,
    accessTokenTtl: 900,
    refreshTokenTtl: 60 * 60 * 24,
    isProtected: false,
    disabledAt: null,
  };
  const existingService = await prisma.client.findUnique({ where: { clientId: DEMO_SERVICE_CLIENT.clientId } });
  if (!existingService || opts.reset) {
    await prisma.client.upsert({
      where: { clientId: DEMO_SERVICE_CLIENT.clientId },
      create: { clientId: DEMO_SERVICE_CLIENT.clientId, ...serviceData },
      update: serviceData,
    });
  }

  // Per-client roles, emitted as resource_access.playground.roles in access tokens.
  const roles: Record<string, string> = {
    viewer: 'Read-only access',
    editor: 'Can modify content',
    billing: 'Manage billing',
  };
  const roleIds: Record<string, string> = {};
  for (const [name, description] of Object.entries(roles)) {
    const r = await prisma.clientRole.upsert({
      where: { clientId_name: { clientId: playground.id, name } },
      create: { clientId: playground.id, name, description },
      update: { description },
    });
    roleIds[name] = r.id;
  }
  const assign = async (userId: string, role: string) => {
    const clientRoleId = roleIds[role]!;
    await prisma.userClientRole.upsert({
      where: { userId_clientRoleId: { userId, clientRoleId } },
      create: { userId, clientRoleId },
      update: {},
    });
  };
  await assign(admin.id, 'editor');
  await assign(admin.id, 'billing');
  await assign(demo.id, 'viewer');

  if (opts.syntheticHistory && (await prisma.auditEvent.count()) === 0) {
    log('Generating synthetic login history for the dashboard');
    const events = [];
    const now = Date.now();
    for (let d = 13; d >= 1; d--) {
      const successes = 4 + Math.round(6 * Math.abs(Math.sin(d * 1.7))) + (d % 7 < 5 ? 3 : 0);
      const failures = Math.round(2 * Math.abs(Math.cos(d * 2.3)));
      for (let i = 0; i < successes + failures; i++) {
        const ok = i < successes;
        const who = i % 3 === 0 ? DEMO_ADMIN.email : DEMO_USER.email;
        events.push({
          type: ok ? 'user.login' : 'user.login_failed',
          success: ok,
          actorEmail: who,
          actorId: who === DEMO_ADMIN.email ? admin.id : demo.id,
          ip: '203.0.113.' + ((d * 7 + i) % 250),
          userAgent: 'Mozilla/5.0 (synthetic seed data)',
          metadata: ok ? { amr: ['pwd'], seeded: true } : { reason: 'bad_password', seeded: true },
          createdAt: new Date(now - d * 86_400_000 + i * 1_800_000),
        });
      }
    }
    await prisma.auditEvent.createMany({ data: events });
  }
  log('Seed complete');
}
