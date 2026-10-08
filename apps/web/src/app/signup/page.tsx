import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  const params = await searchParams;
  return (
    <AuthShell>
      <SignupForm interaction={typeof params.interaction === 'string' ? params.interaction : undefined} />
    </AuthShell>
  );
}
