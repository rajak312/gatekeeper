import type { Metadata } from 'next';
import { UserDetail } from './user-detail';

export const metadata: Metadata = { title: 'User' };

export default async function UserPage({ params }: PageProps<'/admin/users/[id]'>) {
  const { id } = await params;
  return <UserDetail id={id} />;
}
