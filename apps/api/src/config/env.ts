import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const baseUrl = z.url({ protocol: /^https?$/ }).transform((v) => v.replace(/\/+$/, ''));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4500),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'DATABASE_URL must be a postgres:// URL' }),
    /** Public issuer identifier. Must be the origin users see (the web app when proxied). */
    ISSUER_URL: baseUrl,
    /** Origin of the hosted login / consent UI (Next.js app). */
    WEB_URL: baseUrl,
    /** Secret used to derive the AES-256-GCM key that encrypts private signing keys and TOTP secrets. */
    KEY_ENCRYPTION_SECRET: z
      .string()
      .min(32, 'KEY_ENCRYPTION_SECRET must be at least 32 characters (try: openssl rand -base64 48)'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    /** Express "trust proxy" setting: number of hops, or a comma separated list of subnets. */
    TRUST_PROXY: z.string().default('loopback'),
    DEMO_MODE: bool(false),
    DEMO_RESET_CRON: z.string().default('0 */6 * * *'),
    SEED_ON_BOOT: bool(false),
    MAIL_DRIVER: z.enum(['outbox', 'console']).default('outbox'),
    ACCESS_TOKEN_TTL: z.coerce.number().int().min(60).max(3600).default(900),
    ID_TOKEN_TTL: z.coerce.number().int().min(60).max(86400).default(3600),
    SESSION_TTL: z.coerce
      .number()
      .int()
      .min(300)
      .default(60 * 60 * 24 * 7),
    /** How long a retired signing key stays published in the JWKS. */
    RETIRED_KEY_TTL: z.coerce
      .number()
      .int()
      .min(3600)
      .default(60 * 60 * 24),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCKOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .default(15 * 60),
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }));

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {}

/**
 * Validates process.env and fails fast with a readable message.
 * Secrets are never echoed back - only the names of invalid variables.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new EnvValidationError(
      `Invalid environment configuration:\n${lines.join('\n')}\n\nSee apps/api/.env.example for documentation.`,
    );
  }
  return result.data;
}

export const ENV = Symbol('ENV');
