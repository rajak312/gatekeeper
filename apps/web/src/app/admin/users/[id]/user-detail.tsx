'use client';

import type { AdminUserDetail, AuditEventInfo, ClientSummary, CursorPage } from '@gatekeeper/shared';
import { ArrowLeft, Laptop, Lock, LogOut, ShieldOff, Unlock, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { AuditEventRow } from '@/components/audit-event';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/input';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { describeUserAgent, formatDateTime, timeAgo } from '@/lib/format';
import { UserStatus } from '../user-status';

export function UserDetail({ id }: { id: string }) {
  const toast = useToast();
  const { data: u, mutate, error } = useSWR<AdminUserDetail, Error>(`/api/admin/users/${id}`);
  const { data: clients } = useSWR<ClientSummary[]>('/api/admin/clients');
  const { data: activity } = useSWR<CursorPage<AuditEventInfo>>(
    u ? `/api/admin/audit?q=${encodeURIComponent(u.email)}&limit=8` : null,
  );
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  if (!u) return <Skeleton className="h-96" />;

  const act = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(message);
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const allRoles = (clients ?? []).flatMap((c) => c.roles.map((r) => ({ ...r, client: c })));
  const assigned = new Set(u.clientRoles.map((r) => r.id));

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Users
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={u.name} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {u.name} <UserStatus u={u} /> {u.isProtected ? <Badge>demo account</Badge> : null}
          </h1>
          <p className="text-sm text-muted">
            {u.email} · joined {formatDateTime(u.createdAt)} · last sign-in{' '}
            {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {u.disabled || u.locked ? (
            <Button
              variant="secondary"
              loading={busy === 'unlock'}
              onClick={() =>
                void act('unlock', () => api(`/api/admin/users/${id}/unlock`, { method: 'POST' }), 'User unlocked')
              }
            >
              <Unlock className="size-4" /> Unlock
            </Button>
          ) : (
            <Button
              variant="danger-outline"
              loading={busy === 'lock'}
              onClick={() =>
                void act(
                  'lock',
                  () =>
                    api(`/api/admin/users/${id}/lock`, {
                      method: 'POST',
                      body: { reason: 'Locked from admin console' },
                    }),
                  'User locked and signed out',
                )
              }
            >
              <Lock className="size-4" /> Lock account
            </Button>
          )}
        </div>
      </div>
      {u.disabled ? (
        <Alert tone="danger" title="Account disabled">
          {u.disabledReason ?? 'Locked by an administrator.'} All sessions and tokens were revoked.
        </Alert>
      ) : null}
      {u.locked ? (
        <Alert tone="warning" title="Temporarily locked out">
          Too many failed sign-ins. Lock expires {u.lockedUntil ? timeAgo(u.lockedUntil) : 'soon'}.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Roles" description="Global roles appear in the roles claim." />
          <CardBody className="space-y-3">
            {(['ADMIN', 'USER'] as const).map((r) => (
              <Checkbox
                key={r}
                id={`role-${r}`}
                checked={u.roles.includes(r)}
                disabled={u.isProtected || busy === 'roles'}
                label={r === 'ADMIN' ? 'Administrator' : 'User'}
                description={r === 'ADMIN' ? 'Full access to this console' : 'Can sign in to applications'}
                onChange={(on) => {
                  const roles = on ? [...u.roles, r] : u.roles.filter((x) => x !== r);
                  if (roles.length)
                    void act(
                      'roles',
                      () => api(`/api/admin/users/${id}/roles`, { method: 'PATCH', body: { roles } }),
                      'Roles updated',
                    );
                }}
              />
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Multi-factor authentication" />
          <CardBody className="flex items-center justify-between gap-3">
            <p className="text-sm">
              {u.mfaEnabled ? <Badge tone="success">TOTP enabled</Badge> : <Badge>Not enrolled</Badge>}
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={!u.mfaEnabled || u.isProtected}
              loading={busy === 'mfa'}
              onClick={() =>
                void act(
                  'mfa',
                  () => api(`/api/admin/users/${id}/reset-mfa`, { method: 'POST' }),
                  'MFA reset - user can enroll again',
                )
              }
            >
              <ShieldOff className="size-3.5" /> Reset MFA
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Client roles"
          description="Per-application roles, emitted as resource_access.<client>.roles."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {u.clientRoles.length === 0 ? <p className="text-sm text-muted">No client roles assigned.</p> : null}
            {u.clientRoles.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 py-1 pr-1 pl-2.5 text-xs"
              >
                <span className="text-subtle">{r.clientName}</span>
                <span className="font-mono font-medium">{r.name}</span>
                <button
                  type="button"
                  disabled={u.isProtected}
                  aria-label="Remove role"
                  className="rounded p-0.5 text-subtle hover:text-red-500 disabled:opacity-40"
                  onClick={() =>
                    void act(
                      'crole',
                      () => api(`/api/admin/users/${id}/client-roles/${r.id}`, { method: 'DELETE' }),
                      'Role removed',
                    )
                  }
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="h-9 max-w-xs">
              <option value="">Assign a client role…</option>
              {allRoles
                .filter((r) => !assigned.has(r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.client.name} → {r.name}
                  </option>
                ))}
            </Select>
            <Button
              variant="secondary"
              disabled={!roleId}
              onClick={() =>
                void act(
                  'crole',
                  () => api(`/api/admin/users/${id}/client-roles`, { method: 'POST', body: { clientRoleId: roleId } }),
                  'Role assigned',
                ).then(() => setRoleId(''))
              }
            >
              Assign
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sessions"
          actions={
            u.sessions.length ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void act(
                    'sessions',
                    () => api(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST' }),
                    'Sessions revoked',
                  )
                }
              >
                <LogOut className="size-3.5" /> Sign out everywhere
              </Button>
            ) : null
          }
        />
        <ul className="divide-y divide-border">
          {u.sessions.length === 0 ? <li className="px-5 py-4 text-sm text-muted">No active sessions.</li> : null}
          {u.sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <Laptop className="size-4 text-subtle" />
              <span className="font-medium">{describeUserAgent(s.userAgent)}</span>
              <span className="text-xs text-subtle">
                {s.ip} · {s.amr.join(', ')} · active {timeAgo(s.lastSeenAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Recent activity" />
        <div className="space-y-3.5 px-5 py-4">
          {(activity?.items ?? []).map((e) => (
            <AuditEventRow key={e.id} event={e} />
          ))}
          {activity && activity.items.length === 0 ? <p className="text-sm text-muted">No events.</p> : null}
        </div>
      </Card>
    </div>
  );
}
