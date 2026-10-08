'use client';

import type { ScopeInfo } from '@gatekeeper/shared';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';

export default function ScopesPage() {
  const toast = useToast();
  const { data, mutate } = useSWR<ScopeInfo[]>('/api/admin/scopes');
  const [form, setForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/admin/scopes', { method: 'POST', body: form });
      setForm({ name: '', description: '' });
      toast.success('Scope created - it is now in the discovery document');
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Scopes"
        description="Permissions that applications can request. Descriptions are shown to users on the consent screen."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="overflow-hidden">
          {!data ? (
            <Skeleton className="m-5 h-40" />
          ) : (
            <ul className="divide-y divide-border">
              {data.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <code className="font-mono text-sm font-medium">{s.name}</code>
                      {s.isSystem ? (
                        <Badge>
                          <Lock className="size-3" /> OIDC
                        </Badge>
                      ) : (
                        <Badge tone="brand">custom</Badge>
                      )}
                    </p>
                    <p className="text-sm text-muted">{s.description}</p>
                  </div>
                  {!s.isSystem ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${s.name}`}
                      onClick={() =>
                        api(`/api/admin/scopes/${s.id}`, { method: 'DELETE' })
                          .then(() => mutate())
                          .catch((err: unknown) => toast.error(errorMessage(err)))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="New scope" />
          <CardBody>
            <form onSubmit={create} className="space-y-4">
              <Field label="Name" htmlFor="s-name" hint="e.g. invoices:read">
                <Input
                  id="s-name"
                  className="font-mono text-sm"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Consent text" htmlFor="s-desc" hint="Finish the sentence “This will allow the app to…”">
                <Input
                  id="s-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Read your invoices"
                />
              </Field>
              <Button type="submit" loading={busy} disabled={!form.name || form.description.length < 3}>
                <Plus className="size-4" /> Create scope
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
