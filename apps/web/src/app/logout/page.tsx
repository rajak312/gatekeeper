import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { LogoutView } from './logout-view';

export const metadata: Metadata = { title: 'Sign out' };

export default async function LogoutPage({ searchParams }: PageProps<'/logout'>) {
  const p = await searchParams;
  const str = (k: string) => (typeof p[k] === 'string' ? p[k] : undefined);
  return (
    <AuthShell>
      <LogoutView
        done={str('done') === '1'}
        clientId={str('client_id')}
        postLogoutRedirectUri={str('post_logout_redirect_uri')}
        state={str('state')}
      />
    </AuthShell>
  );
}
