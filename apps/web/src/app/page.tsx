import {
  ArrowRight,
  BadgeCheck,
  FileClock,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  Lock,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { buttonClasses } from '@/components/ui/button';

const FEATURES = [
  {
    icon: Workflow,
    title: 'Authorization Code + PKCE',
    body: 'OAuth 2.1 by default: S256 PKCE required for every client, exact redirect URI matching, state, nonce and RFC 9207 iss.',
  },
  {
    icon: RefreshCw,
    title: 'Refresh token rotation',
    body: 'Every refresh rotates the token. Replaying an old one is detected and revokes the whole token family.',
  },
  {
    icon: KeyRound,
    title: 'Key rotation & JWKS',
    body: 'RS256 keys with kid, encrypted at rest. Rotate with one click - retired keys stay published until tokens expire.',
  },
  {
    icon: Smartphone,
    title: 'TOTP multi-factor auth',
    body: 'RFC 6238 authenticator apps with QR enrollment, replay protection and single-use recovery codes.',
  },
  {
    icon: Lock,
    title: 'Hardened sessions',
    body: '__Host- cookies, SameSite, CSRF double-submit + Origin checks, argon2id, lockout and rate limiting.',
  },
  {
    icon: FileClock,
    title: 'Audit trail',
    body: 'Logins, MFA, consent, token reuse and admin changes - searchable in the console, never containing secrets.',
  },
];

const SPECS = [
  'OAuth 2.1',
  'OpenID Connect Core',
  'RFC 7636 PKCE',
  'RFC 7009 Revocation',
  'RFC 7662 Introspection',
  'RFC 8414 Metadata',
  'RFC 9068 JWT ATs',
  'RFC 9207 iss',
  'RFC 6238 TOTP',
  'RP-Initiated Logout',
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden">
          <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_65%)]" />
          <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl dark:bg-brand-500/15" />
          <div className="relative mx-auto max-w-5xl px-6 pt-20 pb-16 text-center sm:pt-28">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
              <BadgeCheck className="size-3.5 text-brand-500" /> Self-hosted OAuth 2.1 &amp; OpenID Connect provider
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Authentication you can{' '}
              <span className="bg-gradient-to-r from-brand-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
                actually read
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted sm:text-lg">
              Gatekeeper is a mini Keycloak built from scratch with NestJS, Next.js and PostgreSQL - PKCE, rotating
              refresh tokens with reuse detection, TOTP MFA, key rotation and a full admin console.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/playground" className={buttonClasses('primary', 'lg')}>
                <Fingerprint className="size-4" /> Try the OAuth playground
              </Link>
              <Link href="/admin" className={buttonClasses('secondary', 'lg')}>
                <LayoutDashboard className="size-4" /> Open admin console
              </Link>
            </div>
            <p className="mt-4 text-xs text-subtle">
              Demo logins: <span className="font-mono">demo@gatekeeper.dev / demo1234</span> ·{' '}
              <span className="font-mono">admin@gatekeeper.dev / admin1234</span>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-20">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xl shadow-black/[0.04] dark:shadow-black/40">
            <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
              <span className="size-2.5 rounded-full bg-red-400/80" />
              <span className="size-2.5 rounded-full bg-amber-400/80" />
              <span className="size-2.5 rounded-full bg-emerald-400/80" />
              <span className="ml-3 font-mono text-xs text-subtle">Authorization Code flow with PKCE</span>
            </div>
            <ol className="grid divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              {[
                ['App', 'creates code_verifier, sends SHA-256 challenge + state + nonce'],
                ['Gatekeeper', 'authenticates (password → TOTP) and asks for consent'],
                ['App', 'exchanges single-use code + verifier at /oauth/token'],
                ['App', 'verifies the ID token against JWKS and calls APIs'],
              ].map(([who, what], i) => (
                <li key={i} className="p-5">
                  <span className="font-mono text-xs text-brand-600 dark:text-brand-400">0{i + 1}</span>
                  <p className="mt-2 text-sm font-medium">{who}</p>
                  <p className="mt-1 text-sm text-muted">{what}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-y border-border bg-surface/50">
          <div className="mx-auto grid max-w-5xl gap-px overflow-hidden px-6 py-16 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="p-5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-800/50">
                  <Icon className="size-4" />
                </span>
                <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16 text-center">
          <ShieldCheck className="mx-auto size-6 text-brand-500" />
          <h2 className="mt-3 text-xl font-semibold tracking-tight">Standards, not shortcuts</h2>
          <div className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-2">
            {SPECS.map((s) => (
              <span key={s} className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
                {s}
              </span>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a href="/.well-known/openid-configuration" className={buttonClasses('secondary')}>
              Discovery document <ArrowRight className="size-4" />
            </a>
            <a href="/docs" className={buttonClasses('ghost')}>
              REST API reference
            </a>
          </div>
        </section>
      </main>
      <footer className="border-t border-border py-8 text-center text-xs text-subtle">
        Built by{' '}
        <a href="https://github.com/rajak312" className="font-medium text-muted hover:text-fg">
          Lalit Rajak
        </a>{' '}
        · NestJS · Next.js · Prisma · PostgreSQL
      </footer>
    </>
  );
}
