'use client';

import type { CurrentUser } from '@gatekeeper/shared';
import { ShieldX } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { buttonClasses } from './ui/button';
import { Spinner } from './ui/spinner';

/** Client-side guard. The API enforces authorization; this only drives the UX. */
export function RequireAuth({ admin, children }: { admin?: boolean; children: (me: CurrentUser) => ReactNode }) {
  const { data: me, error, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const unauthenticated = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (isLoading || unauthenticated || (!me && !error)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-brand-500" />
      </div>
    );
  }
  if (!me) return null;
  if (admin && !me.roles.includes('ADMIN')) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <ShieldX className="size-10 text-subtle" />
        <h1 className="text-lg font-semibold">Administrators only</h1>
        <p className="max-w-sm text-sm text-muted">
          You&apos;re signed in as {me.email}. Sign in with the demo admin account (
          <span className="font-mono">admin@gatekeeper.dev</span>) to explore the console.
        </p>
        <Link href="/account" className={buttonClasses('secondary')}>
          Back to account
        </Link>
      </div>
    );
  }
  return <>{children(me)}</>;
}
