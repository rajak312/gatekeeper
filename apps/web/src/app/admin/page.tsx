'use client';

import type { DashboardStats } from '@gatekeeper/shared';
import { AppWindow, ArrowUpRight, KeyRound, MonitorSmartphone, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';
import { AuditEventRow } from '@/components/audit-event';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { LoginsChart } from './logins-chart';

function Stat({
  label,
  value,
  icon: Icon,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
  hint?: string;
  tone?: 'danger';
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <Icon className={cn('size-4 text-subtle', tone === 'danger' && 'text-red-500')} />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-subtle">{hint}</p> : null}
    </Card>
  );
}

export default function DashboardPage() {
  const { data } = useSWR<DashboardStats>('/api/admin/stats', { refreshInterval: 30_000 });
  const total = data?.loginsByDay.reduce((a, d) => a + d.success + d.failure, 0) ?? 0;
  const failed = data?.loginsByDay.reduce((a, d) => a + d.failure, 0) ?? 0;

  return (
    <>
      <PageHeader title="Dashboard" description="Health of your identity provider at a glance." />
      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Users"
              value={data.totals.users}
              icon={Users}
              hint={`${data.totals.mfaUsers} with MFA (${data.totals.users ? Math.round((data.totals.mfaUsers / data.totals.users) * 100) : 0}%)`}
            />
            <Stat label="Applications" value={data.totals.clients} icon={AppWindow} hint="registered OAuth clients" />
            <Stat
              label="Active sessions"
              value={data.totals.activeSessions}
              icon={MonitorSmartphone}
              hint={`${data.totals.activeGrants} active grants`}
            />
            <Stat
              label="Security alerts (24h)"
              value={data.securityAlerts24h}
              icon={data.securityAlerts24h ? ShieldAlert : ShieldCheck}
              tone={data.securityAlerts24h ? 'danger' : undefined}
              hint="reuse, lockouts, MFA failures"
            />
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader
                title="Sign-ins"
                description={`Last 14 days · ${total} attempts, ${total ? Math.round((failed / total) * 100) : 0}% failed`}
              />
              <CardBody>
                <LoginsChart data={data.loginsByDay} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Recent activity"
                actions={
                  <Link
                    href="/admin/audit"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    View all <ArrowUpRight className="size-3" />
                  </Link>
                }
              />
              <div className="space-y-3.5 px-5 py-4">
                {data.recentEvents.map((e) => (
                  <AuditEventRow key={e.id} event={e} compact />
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                href: '/admin/clients',
                icon: AppWindow,
                title: 'Register an application',
                body: 'Public SPA or confidential server-side client with PKCE.',
              },
              {
                href: '/admin/keys',
                icon: KeyRound,
                title: 'Rotate signing keys',
                body: 'Zero-downtime: old keys stay in the JWKS until tokens expire.',
              },
              {
                href: '/playground',
                icon: ShieldCheck,
                title: 'Open the playground',
                body: 'Run a full Authorization Code + PKCE flow and inspect tokens.',
              },
            ].map(({ href, icon: Icon, title, body }) => (
              <Link
                key={href}
                href={href}
                className="group rounded-xl border border-border bg-surface p-4 transition hover:border-brand-300 hover:shadow-sm dark:hover:border-brand-800"
              >
                <Icon className="size-5 text-brand-600 dark:text-brand-400" />
                <p className="mt-3 flex items-center gap-1 text-sm font-medium">
                  {title}{' '}
                  <ArrowUpRight className="size-3.5 text-subtle transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </p>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
