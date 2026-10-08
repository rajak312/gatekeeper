'use client';

import type { AdminUserSummary, Paginated } from '@gatekeeper/shared';
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { timeAgo } from '@/lib/format';
import { UserStatus } from './user-status';

export default function UsersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useSWR<Paginated<AdminUserSummary>>(
    `/api/admin/users?page=${page}&pageSize=15${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`,
    {
      keepPreviousData: true,
    },
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Users"
        description={data ? `${data.total} accounts` : 'Accounts that can sign in with Gatekeeper.'}
      />
      <Card className="overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              placeholder="Search by name or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
        </div>
        {!data ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title="No users match your search" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2/50 text-left text-xs text-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">User</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Security</th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((u) => (
                <tr
                  key={u.id}
                  className="cursor-pointer transition hover:bg-surface-2/50"
                  onClick={() => router.push(`/admin/users/${u.id}`)}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-medium">
                          {u.name}
                          {u.roles.includes('ADMIN') ? <Badge tone="brand">admin</Badge> : null}
                        </p>
                        <p className="truncate text-xs text-subtle">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <UserStatus u={u} />
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">
                    <div className="flex gap-1.5">
                      {u.mfaEnabled ? <Badge tone="success">MFA</Badge> : <Badge>no MFA</Badge>}
                      {!u.emailVerified ? <Badge tone="warning">unverified</Badge> : null}
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 text-xs text-subtle sm:table-cell">
                    {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && pages > 1 ? (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted">
            <span>
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
