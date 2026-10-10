'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/hooks';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

const GITHUB = process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com/lalitkumarrajak/gatekeeper';

export function SiteHeader() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const links = [
    { href: '/playground', label: 'Playground' },
    { href: '/account', label: 'Account' },
    ...(me?.roles.includes('ADMIN') ? [{ href: '/admin', label: 'Admin' }] : []),
    { href: '/docs', label: 'API docs', external: true },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 text-sm sm:flex">
          {links.map((l) =>
            l.external ? (
              <a key={l.href} href={l.href} className="rounded-md px-2.5 py-1.5 text-muted hover:text-fg">
                {l.label}
              </a>
            ) : (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-muted hover:text-fg',
                  pathname.startsWith(l.href) && 'font-medium text-fg',
                )}
              >
                {l.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a
            href={GITHUB}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
            aria-label="GitHub repository"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
              <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
            </svg>
          </a>
          <ThemeToggle />
          {me ? null : (
            <Link href="/login" className="ml-1 rounded-lg px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
