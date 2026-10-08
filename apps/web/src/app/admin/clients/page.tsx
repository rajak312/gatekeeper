'use client';

import type { ClientSummary, ClientWithSecret } from '@gatekeeper/shared';
import { AppWindow, ChevronRight, Lock, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { ClientForm, initialValue, toPayload } from './client-form';
import { SecretDialog } from './secret-dialog';

export default function ClientsPage() {
  const router = useRouter();
  const { data, mutate } = useSWR<ClientSummary[]>('/api/admin/clients');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialValue());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ClientWithSecret | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<ClientWithSecret>('/api/admin/clients', { method: 'POST', body: toPayload(form) });
      setOpen(false);
      setForm(initialValue());
      void mutate();
      if (res.clientSecret) setCreated(res);
      else router.push(`/admin/clients/${res.client.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Applications"
        description="OAuth clients that can sign users in or call APIs with Gatekeeper tokens."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New application
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {!data ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon={<AppWindow className="size-5" />} title="No applications yet" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2/50 text-left text-xs text-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Application</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Type</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Grants</th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Created</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((c) => (
                <tr
                  key={c.id}
                  className="group cursor-pointer transition hover:bg-surface-2/50"
                  onClick={() => router.push(`/admin/clients/${c.id}`)}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-semibold text-white">
                        {c.name.charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <Link
                          href={`/admin/clients/${c.id}`}
                          className="flex items-center gap-1.5 font-medium text-fg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.name}
                          {c.isProtected ? (
                            <Lock className="size-3 text-subtle" aria-label="Protected demo client" />
                          ) : null}
                          {c.disabled ? <Badge tone="danger">disabled</Badge> : null}
                        </Link>
                        <p className="font-mono text-xs text-subtle">{c.clientId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">
                    <Badge tone={c.type === 'PUBLIC' ? 'neutral' : 'brand'}>{c.type.toLowerCase()}</Badge>
                  </td>
                  <td className="hidden px-3 py-3 lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {c.grantTypes.map((g) => (
                        <span key={g} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                          {g}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 text-xs text-subtle sm:table-cell">{timeAgo(c.createdAt)}</td>
                  <td className="pr-4">
                    <ChevronRight className="size-4 text-subtle transition group-hover:translate-x-0.5" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New application"
        description="Register an OAuth 2.1 client."
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void create()} loading={busy} disabled={!form.name}>
              Create application
            </Button>
          </>
        }
      >
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <ClientForm value={form} onChange={setForm} />
        </div>
      </Dialog>

      <SecretDialog
        clientId={created?.client.clientId ?? ''}
        secret={created?.clientSecret ?? null}
        onClose={() => {
          const id = created?.client.id;
          setCreated(null);
          if (id) router.push(`/admin/clients/${id}`);
        }}
      />
    </>
  );
}
