import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { ApiStatusGate } from './api-status';

/** Centered card layout for the hosted login / consent / MFA pages. */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <ApiStatusGate>
      <div className="relative flex min-h-dvh flex-col">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-brand-500/10 to-transparent dark:from-brand-500/15" />
        <header className="relative flex items-center justify-between px-6 py-5">
          <Logo />
          <ThemeToggle />
        </header>
        <main className="relative flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12">
          <div className="w-full max-w-[400px] animate-slide-up">
            {children}
            {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
          </div>
        </main>
        <footer className="relative px-6 pb-6 text-center text-xs text-subtle">
          Secured by Gatekeeper ·{' '}
          <Link href="/" className="hover:text-fg">
            OAuth 2.1 &amp; OpenID Connect
          </Link>
        </footer>
      </div>
    </ApiStatusGate>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-7 shadow-xl shadow-black/[0.03] dark:shadow-black/40">
      {icon ? <div className="mb-4">{icon}</div> : null}
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <div className="mt-1.5 text-sm text-muted">{subtitle}</div> : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}
