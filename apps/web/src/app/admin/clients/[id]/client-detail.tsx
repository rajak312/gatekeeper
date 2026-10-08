'use client';

import type { ClientSummary, ClientWithSecret } from '@gatekeeper/shared';
import { ArrowLeft, KeyRound, Lock, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ClientForm, initialValue, toPayload, type ClientFormValue } from '../client-form';
import { SecretDialog } from '../secret-dialog';

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-40 shrink-0 text-xs text-subtle">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{value}</code>
      {copy ? <CopyButton value={value} /> : null}
    </div>
  );
}

export function ClientDetail({ id }: { id: string }) {
  const { data: client, mutate, error } = useSWR<ClientSummary, Error>(`/api/admin/clients/${id}`);
  if (error) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  if (!client) return <Skeleton className="h-96" />;
  return <ClientEditor key={client.id} id={id} client={client} mutate={() => void mutate()} />;
}

function ClientEditor({ id, client, mutate }: { id: string; client: ClientSummary; mutate: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<ClientFormValue>(() => initialValue(client));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [roleName, setRoleName] = useState('');
  // Rendered client-side only (behind RequireAuth), so window is available.
  const origin = window.location.origin;

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const { type: _type, ...payload } = toPayload(form);
      await api(`/api/admin/clients/${id}`, { method: 'PATCH', body: payload });
      toast.success('Application saved');
      mutate();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/clients" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Applications
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-lg font-bold text-white">
          {client.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {client.name}
            <Badge tone={client.type === 'PUBLIC' ? 'neutral' : 'brand'}>{client.type.toLowerCase()}</Badge>
            {client.isProtected ? (
              <Badge>
                <Lock className="size-3" /> demo
              </Badge>
            ) : null}
          </h1>
          <p className="text-sm text-muted">Created {formatDateTime(client.createdAt)}</p>
        </div>
        <Button variant="danger-outline" onClick={() => setConfirmDelete(true)} disabled={client.isProtected}>
          <Trash2 className="size-4" /> Delete
        </Button>
      </div>

      {client.isProtected ? (
        <Alert tone="info">
          This client powers the shared demo, so its redirect URIs, grants and scopes are locked. Create your own
          application to edit everything.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Credentials & endpoints" description="Everything an application needs to integrate." />
        <CardBody className="divide-y divide-border py-1">
          <Row label="client_id" value={client.clientId} copy />
          {client.type === 'CONFIDENTIAL' ? (
            <div className="flex items-center gap-3 py-2">
              <span className="w-40 shrink-0 text-xs text-subtle">client_secret</span>
              <code className="flex-1 font-mono text-xs text-muted">••••••••••••{client.secretHint}</code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmRotate(true)}
                disabled={client.isProtected}
              >
                <KeyRound className="size-3.5" /> Regenerate
              </Button>
            </div>
          ) : (
            <Row label="client authentication" value="none (public client - PKCE S256 required)" />
          )}
          <Row label="Discovery" value={`${origin}/.well-known/openid-configuration`} copy />
          <Row label="Authorization endpoint" value={`${origin}/oauth/authorize`} />
          <Row label="Token endpoint" value={`${origin}/oauth/token`} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Settings"
          actions={
            <Button onClick={() => void save()} loading={saving}>
              Save changes
            </Button>
          }
        />
        <CardBody className="space-y-4">
          {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
          <ClientForm value={form} onChange={setForm} editing locked={client.isProtected} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Client roles"
          description={
            <>
              Assigned per user and emitted in access tokens as{' '}
              <code className="font-mono">resource_access.{client.clientId}.roles</code>.
            </>
          }
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {client.roles.length === 0 ? <p className="text-sm text-muted">No roles defined.</p> : null}
            {client.roles.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 py-1 pr-1 pl-2.5 text-sm"
              >
                <span className="font-mono text-xs">{r.name}</span>
                {r.description ? <span className="text-xs text-subtle">· {r.description}</span> : null}
                <button
                  type="button"
                  className="rounded p-0.5 text-subtle hover:bg-surface hover:text-red-500 disabled:opacity-40"
                  disabled={client.isProtected}
                  aria-label={`Delete role ${r.name}`}
                  onClick={() =>
                    api(`/api/admin/clients/${id}/roles/${r.id}`, { method: 'DELETE' })
                      .then(mutate)
                      .catch((e: unknown) => toast.error(errorMessage(e)))
                  }
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              api(`/api/admin/clients/${id}/roles`, { method: 'POST', body: { name: roleName } })
                .then(() => {
                  setRoleName('');
                  mutate();
                })
                .catch((err: unknown) => toast.error(errorMessage(err)));
            }}
          >
            <Input
              placeholder="e.g. reports:viewer"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              className="max-w-xs font-mono text-xs"
            />
            <Button type="submit" variant="secondary" disabled={!roleName}>
              <Plus className="size-4" /> Add role
            </Button>
          </form>
        </CardBody>
      </Card>

      <Dialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        title="Regenerate client secret?"
        description="The current secret stops working immediately. Update your application right after."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRotate(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                api<ClientWithSecret>(`/api/admin/clients/${id}/secret`, { method: 'POST' })
                  .then((r) => {
                    setConfirmRotate(false);
                    setSecret(r.clientSecret);
                    mutate();
                  })
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              Regenerate
            </Button>
          </>
        }
      />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${client.name}?`}
        description="All consents, grants and tokens issued to this application are deleted. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                api(`/api/admin/clients/${id}`, { method: 'DELETE' })
                  .then(() => {
                    toast.success('Application deleted');
                    router.push('/admin/clients');
                  })
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              Delete application
            </Button>
          </>
        }
      />
      <SecretDialog clientId={client.clientId} secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}
