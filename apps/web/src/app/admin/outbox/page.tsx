'use client';

import type { OutboxEmailInfo } from '@gatekeeper/shared';
import { ExternalLink, Inbox, Mail } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';

export default function OutboxPage() {
  const { data } = useSWR<OutboxEmailInfo[]>('/api/admin/outbox', { refreshInterval: 10_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const current = data?.find((m) => m.id === selected) ?? data?.[0];
  const link = current ? /https?:\/\/\S+/.exec(current.text)?.[0] : undefined;

  return (
    <>
      <PageHeader
        title="Dev outbox"
        description="Gatekeeper has no email provider in this deployment. Messages are stored here instead of being delivered."
      />
      <Alert tone="info" className="mb-6">
        The mailer is pluggable (<code className="font-mono">MAIL_DRIVER</code>). Swap the outbox transport for SMTP,
        Resend or SES in production.
      </Alert>
      <Card className="overflow-hidden">
        {data && data.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="No emails yet"
            description="Sign up or request a password reset to see messages here."
          />
        ) : (
          <div className="grid min-h-[480px] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <ul className="divide-y divide-border border-b border-border md:border-r md:border-b-0">
              {(data ?? []).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(m.id)}
                    className={cn(
                      'w-full cursor-pointer px-4 py-3 text-left transition hover:bg-surface-2/50',
                      current?.id === m.id && 'bg-surface-2/70',
                    )}
                  >
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Mail className="size-3.5 text-subtle" /> <span className="truncate">{m.subject}</span>
                    </p>
                    <p className="mt-0.5 flex items-center justify-between gap-2 text-xs text-subtle">
                      <span className="truncate">{m.to}</span>
                      <span className="shrink-0">{timeAgo(m.createdAt)}</span>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {current ? (
              <div className="flex min-w-0 flex-col">
                <div className="space-y-1 border-b border-border px-5 py-3 text-sm">
                  <p className="font-medium">{current.subject}</p>
                  <p className="text-xs text-subtle">
                    To {current.to} · <Badge>{current.template}</Badge>
                  </p>
                  {link ? (
                    <a
                      href={link}
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Open link <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
                {/* Rendered in a fully sandboxed iframe: no scripts, no same-origin access. */}
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={current.html}
                  className="min-h-[400px] w-full flex-1 bg-zinc-100"
                />
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </>
  );
}
