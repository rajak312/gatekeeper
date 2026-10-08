import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { VerifyEmail } from './verify-email';

export const metadata: Metadata = { title: 'Verify email' };

export default async function VerifyEmailPage({ searchParams }: PageProps<'/verify-email'>) {
  const p = await searchParams;
  return (
    <AuthShell>
      <VerifyEmail token={typeof p.token === 'string' ? p.token : ''} />
    </AuthShell>
  );
}
