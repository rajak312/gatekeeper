import type { ReactNode } from 'react';
import { ApiStatusGate } from '@/components/api-status';
import { SiteHeader } from '@/components/site-header';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <ApiStatusGate>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </ApiStatusGate>
  );
}
