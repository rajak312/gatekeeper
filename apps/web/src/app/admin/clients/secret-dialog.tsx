'use client';

import { KeyRound } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog } from '@/components/ui/dialog';

export function SecretDialog({
  clientId,
  secret,
  onClose,
}: {
  clientId: string;
  secret: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(secret)}
      onClose={onClose}
      title="Save your client secret"
      footer={<Button onClick={onClose}>I&apos;ve saved it</Button>}
    >
      <div className="space-y-4">
        <Alert tone="warning">This is the only time the secret is shown. Gatekeeper stores only a SHA-256 hash.</Alert>
        {[
          ['client_id', clientId],
          ['client_secret', secret ?? ''],
        ].map(([k, v]) => (
          <div key={k}>
            <p className="mb-1 font-mono text-xs text-subtle">{k}</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2">
              {k === 'client_secret' ? <KeyRound className="size-3.5 shrink-0 text-amber-500" /> : null}
              <code className="min-w-0 flex-1 font-mono text-xs break-all">{v}</code>
              <CopyButton value={v!} />
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
