import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { ConsentForm } from './consent-form';

export const metadata: Metadata = { title: 'Authorize application' };

export default async function ConsentPage({ searchParams }: PageProps<'/consent'>) {
  const params = await searchParams;
  return (
    <AuthShell>
      <ConsentForm interaction={typeof params.interaction === 'string' ? params.interaction : ''} />
    </AuthShell>
  );
}
