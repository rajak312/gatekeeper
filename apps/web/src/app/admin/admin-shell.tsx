'use client';

import type { CurrentUser } from '@gatekeeper/shared';
import { AppWindow, FileClock, Gauge, Inbox, KeyRound, LogOut, Menu, Play, Tags, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { RequireAuth } from '@/components/require-auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useSignOut } from '@/lib/hooks';

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: Gauge, exact: true },
  { href: '/admin/clients', label: 'Applications', icon: AppWindow },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/keys', label: 'Signing keys', icon: KeyRound },
  { href: '/admin/scopes', label: 'Scopes', icon: Tags },
  { href: '/admin/audit', label: 'Audit log', icon: FileClock },
  { href: '/admin/outbox', label: 'Dev outbox', icon: Inbox },
];

function Sidebar({ me, onNavigate }: { me: CurrentUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  const signOut = useSignOut();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo href="/admin" />
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        <p className="px-2 pb-2 text-[11px] font-medium tracking-wider text-subtle uppercase">Manage</p>
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition',
                active
                  ? 'bg-surface-2 font-medium text-fg ring-1 ring-border'
                  : 'text-muted hover:bg-surface-2/70 hover:text-fg',
              )}
            >
              <Icon className={cn('size-4', active ? 'text-brand-600 dark:text-brand-400' : 'text-subtle')} />
              {label}
            </Link>
          );
        })}
        <p className="px-2 pt-5 pb-2 text-[11px] font-medium tracking-wider text-subtle uppercase">Explore</p>
        <Link
          href="/playground"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2/70 hover:text-fg"
        >
          <Play className="size-4 text-subtle" /> OAuth playground
        </Link>
        <a
          href="/docs"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2/70 hover:text-fg"
        >
          <FileClock className="size-4 text-subtle" /> API reference
        </a>
      </nav>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
          <Avatar name={me.name} className="size-7 text-[10px]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.name}</p>
            <p className="truncate text-xs text-subtle">{me.email}</p>
          </div>
          <button
            type="button"
            aria-label="Sign out"
            className="cursor-pointer rounded-md p-1.5 text-subtle hover:bg-surface-2 hover:text-fg"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <RequireAuth admin>
      {(me) => (
        <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
          <aside className="hidden border-r border-border bg-surface lg:sticky lg:top-0 lg:block lg:h-dvh">
            <Sidebar me={me} />
          </aside>
          {open ? (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
              <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">
                <Sidebar me={me} onNavigate={() => setOpen(false)} />
              </aside>
            </div>
          ) : null}
          <div className="min-w-0">
            <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md sm:px-8">
              <button
                type="button"
                className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden"
                onClick={() => setOpen(!open)}
                aria-label="Menu"
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
              <span className="text-sm text-muted">Admin console</span>
              <div className="ml-auto flex items-center gap-1">
                <ThemeToggle />
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</main>
          </div>
        </div>
      )}
    </RequireAuth>
  );
}
