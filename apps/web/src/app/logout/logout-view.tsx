'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/auth-shell';
import { Button, buttonClasses } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useMe } from '@/lib/hooks';

/**
 * Confirmation step for RP-initiated logout when no valid id_token_hint was
 * supplied - prevents a third-party page from silently logging users out.
 */
export function LogoutView(props: {
  done: boolean;
  clientId?: string;
  postLogoutRedirectUri?: string;
  state?: string;
}) {
  const { data: me, isLoading } = useMe();
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(props.done);

  async function confirm() {
    setBusy(true);
    const res = await api<{ redirectTo: string | null }>('/api/auth/logout', {
      method: 'POST',
      body: { client_id: props.clientId, post_logout_redirect_uri: props.postLogoutRedirectUri, state: props.state },
    }).catch(() => ({ redirectTo: null }));
    if (res.redirectTo) window.location.assign(res.redirectTo);
    else {
      setFinished(true);
      setBusy(false);
    }
  }

  if (finished || (!isLoading && !me)) {
    return (
      <AuthCard title="You’re signed out" subtitle="Your Gatekeeper session has ended on this device.">
        <div className="grid grid-cols-2 gap-3">
          <Link href="/login" className={buttonClasses('primary', 'lg')}>
            Sign in again
          </Link>
          <Link href="/" className={buttonClasses('secondary', 'lg')}>
            Home
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={
        <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted ring-1 ring-border">
          <LogOut className="size-5" />
        </span>
      }
      title="Sign out of Gatekeeper?"
      subtitle={
        <>
          {props.clientId ? (
            <>
              <span className="font-mono">{props.clientId}</span> asked to end your session.{' '}
            </>
          ) : null}
          {me ? <>You are signed in as {me.email}.</> : null}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Link href="/account" className={buttonClasses('secondary', 'lg')}>
          Stay signed in
        </Link>
        <Button size="lg" loading={busy} onClick={() => void confirm()}>
          Sign out
        </Button>
      </div>
    </AuthCard>
  );
}
