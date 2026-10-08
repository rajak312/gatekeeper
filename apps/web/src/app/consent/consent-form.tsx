'use client';

import {
  ArrowLeftRight,
  BadgeCheck,
  Database,
  KeyRound,
  Mail,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { AuthCard } from '@/components/auth-shell';
import { useInteraction } from '@/components/client-banner';
import { LogoMark } from '@/components/logo';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/input';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useSignOut } from '@/lib/hooks';

const SCOPE_ICONS: Record<string, LucideIcon> = {
  openid: KeyRound,
  profile: User,
  email: Mail,
  offline_access: RefreshCw,
  roles: BadgeCheck,
  'api:read': Database,
  'api:write': PencilLine,
};

export function ConsentForm({ interaction }: { interaction: string }) {
  const { data, error } = useInteraction(interaction || undefined);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<'allow' | 'deny' | 'switch' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const signOut = useSignOut();

  async function decide(decision: 'allow' | 'deny') {
    setBusy(decision);
    setFailure(null);
    try {
      const res = await api<{ redirectTo: string }>(`/api/interactions/${encodeURIComponent(interaction)}/consent`, {
        method: 'POST',
        body: { decision, remember },
      });
      window.location.assign(res.redirectTo);
    } catch (err) {
      setFailure(errorMessage(err));
      setBusy(null);
    }
  }

  async function switchAccount() {
    setBusy('switch');
    await signOut(`/login?interaction=${encodeURIComponent(interaction)}`);
  }

  if (error || !interaction) {
    return (
      <AuthCard title="This request has expired" subtitle="Sign-in requests are only valid for 10 minutes.">
        <Alert tone="warning">Go back to the application and start signing in again.</Alert>
      </AuthCard>
    );
  }

  if (!data) {
    return (
      <AuthCard title={<Skeleton className="h-6 w-48" />}>
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthCard>
    );
  }

  const redirectHost = (() => {
    try {
      return new URL(data.redirectUri).host;
    } catch {
      return data.redirectUri;
    }
  })();
  const newScopes = data.scopes.filter((s) => !s.alreadyGranted).length;

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-xl shadow-black/[0.03] dark:shadow-black/40">
      <div className="flex flex-col items-center px-7 pt-7 text-center">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-lg font-bold text-white shadow-sm">
            {data.client.name.charAt(0)}
          </span>
          <ArrowLeftRight className="size-4 text-subtle" />
          <LogoMark className="size-12 rounded-xl" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">
          <span className="text-brand-600 dark:text-brand-400">{data.client.name}</span> wants to access your account
        </h1>
        {data.client.description ? <p className="mt-1.5 text-sm text-muted">{data.client.description}</p> : null}
      </div>

      {data.user ? (
        <div className="mx-7 mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5">
          <Avatar name={data.user.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{data.user.name}</p>
            <p className="truncate text-xs text-subtle">{data.user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void switchAccount()}
            className="cursor-pointer text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Switch
          </button>
        </div>
      ) : null}

      <div className="px-7 pt-5">
        <p className="text-xs font-medium tracking-wide text-subtle uppercase">This will allow {data.client.name} to</p>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {data.scopes.map((s) => {
            const Icon = SCOPE_ICONS[s.name] ?? ShieldCheck;
            return (
              <li key={s.name} className="flex items-start gap-3 px-3.5 py-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-brand-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">{s.description}</p>
                  <p className="font-mono text-[11px] text-subtle">{s.name}</p>
                </div>
                {s.alreadyGranted ? (
                  <Badge>granted</Badge>
                ) : newScopes < data.scopes.length ? (
                  <Badge tone="brand">new</Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-4 px-7 pt-5 pb-7">
        {failure ? <Alert tone="danger">{failure}</Alert> : null}
        <Checkbox
          id="remember"
          checked={remember}
          onChange={setRemember}
          label="Remember this decision"
          description="You won't be asked again for these permissions. Revoke any time from your account."
        />
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            size="lg"
            loading={busy === 'deny'}
            disabled={busy !== null}
            onClick={() => void decide('deny')}
          >
            Deny
          </Button>
          <Button size="lg" loading={busy === 'allow'} disabled={busy !== null} onClick={() => void decide('allow')}>
            Allow access
          </Button>
        </div>
        <p className="text-center text-xs text-subtle">
          You&apos;ll be redirected to <span className="font-mono text-muted">{redirectHost}</span>
        </p>
      </div>
    </div>
  );
}
