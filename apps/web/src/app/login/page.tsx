import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const interaction = typeof params.interaction === 'string' ? params.interaction : undefined;
  const reauth = params.reauth === '1';
  // Only same-origin relative paths are honoured (no open redirects).
  const next = typeof params.next === 'string' && /^\/(?!\/)/.test(params.next) ? params.next : undefined;
  return (
    <AuthShell>
      <LoginForm interaction={interaction} reauth={reauth} next={next} />
    </AuthShell>
  );
}
