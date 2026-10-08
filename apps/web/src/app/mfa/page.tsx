import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { MfaForm } from './mfa-form';

export const metadata: Metadata = { title: 'Two-factor authentication' };

export default async function MfaPage({ searchParams }: PageProps<'/mfa'>) {
  const params = await searchParams;
  return (
    <AuthShell>
      <MfaForm interaction={typeof params.interaction === 'string' ? params.interaction : undefined} />
    </AuthShell>
  );
}
