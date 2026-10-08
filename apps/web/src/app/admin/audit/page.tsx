'use client';

import type { AuditEventInfo, CursorPage } from '@gatekeeper/shared';
import { FileClock, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { AUDIT_GROUPS, AuditEventRow } from '@/components/audit-event';
import { JsonView } from '@/components/json-view';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';

export default function AuditPage() {
  const [type, setType] = useState('');
  const [success, setSuccess] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const base = new URLSearchParams({
    limit: '30',
    ...(type ? { type } : {}),
    ...(success ? { success } : {}),
    ...(debounced ? { q: debounced } : {}),
  });
  const { data, size, setSize, isValidating } = useSWRInfinite<CursorPage<AuditEventInfo>>(
    (index, prev: CursorPage<AuditEventInfo> | null) => {
      if (prev && !prev.nextCursor) return null;
      const params = new URLSearchParams(base);
      if (index > 0 && prev?.nextCursor) params.set('cursor', prev.nextCursor);
      return `/api/admin/audit?${params.toString()}`;
    },
  );
  const items = data?.flatMap((p) => p.items) ?? [];
  const hasMore = Boolean(data?.[data.length - 1]?.nextCursor);

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of security events. Secrets are never logged." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-52" aria-label="Event type">
            {AUDIT_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </Select>
          <Select
            value={success}
            onChange={(e) => setSuccess(e.target.value)}
            className="h-9 w-40"
            aria-label="Outcome"
          >
            <option value="">Any outcome</option>
            <option value="true">Succeeded</option>
            <option value="false">Failed</option>
          </Select>
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              placeholder="Email, client or IP"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
        </div>
        {!data ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<FileClock className="size-5" />} title="No events match these filters" />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="w-full cursor-pointer px-5 py-3 text-left hover:bg-surface-2/40"
                  onClick={() => setOpen(open === e.id ? null : e.id)}
                >
                  <AuditEventRow event={e} />
                </button>
                {open === e.id ? (
                  <div className="px-5 pb-4 pl-15">
                    <JsonView value={e} className="text-[11.5px]" />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {hasMore ? (
          <div className="border-t border-border p-3 text-center">
            <Button variant="secondary" size="sm" loading={isValidating} onClick={() => void setSize(size + 1)}>
              Load more
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}
