import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { ResetForm } from './reset-form';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const p = await searchParams;
  return (
    <AuthShell>
      <ResetForm token={typeof p.token === 'string' ? p.token : ''} />
    </AuthShell>
  );
}
