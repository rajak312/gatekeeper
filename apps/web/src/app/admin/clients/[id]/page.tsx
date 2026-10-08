import type { Metadata } from 'next';
import { ClientDetail } from './client-detail';

export const metadata: Metadata = { title: 'Application' };

export default async function ClientPage({ params }: PageProps<'/admin/clients/[id]'>) {
  const { id } = await params;
  return <ClientDetail id={id} />;
}
