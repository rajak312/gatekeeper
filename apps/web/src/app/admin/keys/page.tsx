'use client';

import type { SigningKeyInfo } from '@gatekeeper/shared';
import { ExternalLink, KeyRound, RotateCw } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';

export default function KeysPage() {
  const toast = useToast();
  const { data, mutate } = useSWR<SigningKeyInfo[]>('/api/admin/keys');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function rotate() {
    setBusy(true);
    try {
      await mutate(await api<SigningKeyInfo[]>('/api/admin/keys/rotate', { method: 'POST' }), { revalidate: false });
      toast.success('New signing key is active');
      setConfirm(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Signing keys"
        description="RSA-2048 keys used to sign ID and access tokens (RS256). Private keys are encrypted at rest with AES-256-GCM."
        actions={
          <>
            <a
              href="/.well-known/jwks.json"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg"
            >
              JWKS <ExternalLink className="size-3.5" />
            </a>
            <Button onClick={() => setConfirm(true)}>
              <RotateCw className="size-4" /> Rotate key
            </Button>
          </>
        }
      />
      <Alert tone="info" className="mb-6" title="Zero-downtime rotation">
        A rotated key keeps being published in the JWKS until every token it signed has expired, so relying parties that
        cache the JWKS keep verifying existing tokens while new ones use the fresh key.
      </Alert>
      <Card className="overflow-hidden">
        {!data ? (
          <Skeleton className="m-5 h-20" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((k) => (
              <li key={k.kid} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span
                  className={`flex size-9 items-center justify-center rounded-lg ${k.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-surface-2 text-subtle'}`}
                >
                  <KeyRound className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm font-medium">{k.kid}</code>
                    {k.status === 'ACTIVE' ? (
                      <Badge tone="success" dot>
                        active · signing
                      </Badge>
                    ) : k.published ? (
                      <Badge tone="warning" dot>
                        retired · verify only
                      </Badge>
                    ) : (
                      <Badge>expired</Badge>
                    )}
                    <Badge>{k.alg}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-subtle">
                    Created {formatDateTime(k.createdAt)}
                    {k.retiredAt ? ` · retired ${timeAgo(k.retiredAt)}` : ''}
                    {k.publishUntil && k.published ? ` · removed from JWKS ${timeAgo(k.publishUntil)}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Rotate the signing key?"
        description="A new key pair is generated and becomes the active signer immediately. The current key moves to verify-only."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void rotate()} loading={busy}>
              Rotate now
            </Button>
          </>
        }
      />
    </>
  );
}
