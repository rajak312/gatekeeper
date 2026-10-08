'use client';

import type { AuditEventInfo, AuthorizedApp, CurrentUser, SessionInfo } from '@gatekeeper/shared';
import { AppWindow, CheckCircle2, Laptop, LogOut, MailWarning, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import useSWR from 'swr';
import { RequireAuth } from '@/components/require-auth';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { describeUserAgent, formatDateTime, timeAgo } from '@/lib/format';
import { useMe, useSignOut } from '@/lib/hooks';
import { MfaCard } from './mfa-card';

export function AccountView() {
  return <RequireAuth>{(me) => <Account me={me} />}</RequireAuth>;
}

function Account({ me }: { me: CurrentUser }) {
  const { mutate } = useMe();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = useSignOut();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={me.name} className="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{me.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {me.email}
            {me.emailVerified ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3" /> verified
              </Badge>
            ) : (
              <Badge tone="warning">unverified</Badge>
            )}
            {me.roles.map((r) => (
              <Badge key={r} tone={r === 'ADMIN' ? 'brand' : 'neutral'}>
                {r.toLowerCase()}
              </Badge>
            ))}
          </p>
        </div>
        <Button
          variant="secondary"
          loading={signingOut}
          onClick={async () => {
            setSigningOut(true);
            await signOut();
          }}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>

      {!me.emailVerified ? (
        <Alert tone="warning" title="Verify your email address">
          <span className="flex flex-wrap items-center gap-2">
            Apps will see <code className="font-mono">email_verified: false</code> until you confirm it.
            <button
              type="button"
              className="cursor-pointer font-medium underline"
              onClick={() =>
                api('/api/auth/resend-verification', { method: 'POST' })
                  .then(() => toast.success('Verification email sent (see the admin dev outbox)'))
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              Resend link
            </button>
          </span>
        </Alert>
      ) : null}

      <ProfileCard me={me} onSaved={() => void mutate()} />
      <MfaCard me={me} onChange={() => void mutate()} />
      <PasswordCard me={me} />
      <SessionsCard />
      <AppsCard />
      <ActivityCard />
    </div>
  );
}

function ProfileCard({ me, onSaved }: { me: CurrentUser; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Profile" description="Released to apps that request the profile scope." />
      <CardBody>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api('/api/account/profile', { method: 'PATCH', body: { name } });
              toast.success('Profile updated');
              onSaved();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="min-w-60 flex-1">
            <Field label="Display name" htmlFor="name">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={me.isProtected} />
            </Field>
          </div>
          <Button type="submit" variant="secondary" loading={busy} disabled={me.isProtected || name === me.name}>
            Save
          </Button>
        </form>
        <p className="mt-3 text-xs text-subtle">Member since {formatDateTime(me.createdAt)}</p>
      </CardBody>
    </Card>
  );
}

function PasswordCard({ me }: { me: CurrentUser }) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Password" description="Changing it signs out your other sessions and revokes app tokens." />
      <CardBody>
        {me.isProtected ? (
          <p className="text-sm text-muted">The shared demo account&apos;s password can&apos;t be changed.</p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api('/api/account/password', { method: 'POST', body: form });
                toast.success('Password changed. Other sessions were signed out.');
                setForm({ currentPassword: '', newPassword: '' });
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Current password" htmlFor="cur">
              <Input
                id="cur"
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              />
            </Field>
            <Field label="New password" htmlFor="new">
              <Input
                id="new"
                type="password"
                autoComplete="new-password"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              loading={busy}
              disabled={!form.currentPassword || form.newPassword.length < 8}
            >
              Update
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function SessionsCard() {
  const toast = useToast();
  const { data, mutate } = useSWR<SessionInfo[]>('/api/account/sessions');
  const others = data?.filter((s) => !s.current).length ?? 0;
  return (
    <Card>
      <CardHeader
        title="Active sessions"
        description="Browsers signed in to Gatekeeper."
        actions={
          others > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                api<{ revoked: number }>('/api/account/sessions/revoke-others', { method: 'POST' })
                  .then((r) => {
                    toast.success(`Signed out ${r.revoked} other session(s)`);
                    void mutate();
                  })
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              Sign out others
            </Button>
          ) : null
        }
      />
      <ul className="divide-y divide-border">
        {!data ? (
          <li className="px-5 py-4">
            <Skeleton className="h-10 w-full" />
          </li>
        ) : (
          data.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-subtle">
                <Laptop className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {describeUserAgent(s.userAgent)} {s.current ? <Badge tone="success">this device</Badge> : null}
                  {s.amr.includes('otp') ? <Badge tone="brand">MFA</Badge> : null}
                </p>
                <p className="text-xs text-subtle">
                  {s.ip ?? 'unknown IP'} · signed in {timeAgo(s.createdAt)} · active {timeAgo(s.lastSeenAt)}
                </p>
              </div>
              {!s.current ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    api(`/api/account/sessions/${s.id}`, { method: 'DELETE' })
                      .then(() => mutate())
                      .catch((e: unknown) => toast.error(errorMessage(e)))
                  }
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

function AppsCard() {
  const toast = useToast();
  const { data, mutate } = useSWR<AuthorizedApp[]>('/api/account/apps');
  return (
    <Card>
      <CardHeader
        title="Connected apps"
        description="Applications you've granted access to. Revoking also invalidates their tokens."
      />
      {data && data.length === 0 ? (
        <EmptyState
          icon={<AppWindow className="size-5" />}
          title="No connected apps"
          description="Try the OAuth Playground to connect one."
        />
      ) : (
        <ul className="divide-y divide-border">
          {(data ?? []).map((a) => (
            <li key={a.clientId} className="flex items-center gap-3 px-5 py-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-semibold text-white">
                {a.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="truncate font-mono text-xs text-subtle">{a.scopes.join(' ')}</p>
              </div>
              <span className="hidden text-xs text-subtle sm:block">{timeAgo(a.grantedAt)}</span>
              <Button
                variant="danger-outline"
                size="sm"
                onClick={() =>
                  api(`/api/account/apps/${encodeURIComponent(a.clientId)}`, { method: 'DELETE' })
                    .then(() => {
                      toast.success(`Access for ${a.name} revoked`);
                      void mutate();
                    })
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityCard() {
  const { data } = useSWR<AuditEventInfo[]>('/api/account/activity');
  return (
    <Card>
      <CardHeader title="Recent security activity" />
      <ul className="divide-y divide-border">
        {(data ?? []).slice(0, 10).map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            {e.success ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
            ) : e.type.includes('reuse') ? (
              <ShieldAlert className="size-4 shrink-0 text-red-500" />
            ) : (
              <MailWarning className="size-4 shrink-0 text-amber-500" />
            )}
            <span className="font-mono text-xs">{e.type}</span>
            {e.clientId ? <Badge>{e.clientId}</Badge> : null}
            <span className="ml-auto text-xs text-subtle">{timeAgo(e.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
