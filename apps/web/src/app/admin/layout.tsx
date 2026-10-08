import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ApiStatusGate } from '@/components/api-status';
import { AdminShell } from './admin-shell';

export const metadata: Metadata = { title: { default: 'Admin console', template: '%s · Gatekeeper admin' } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ApiStatusGate>
      <AdminShell>{children}</AdminShell>
    </ApiStatusGate>
  );
}
