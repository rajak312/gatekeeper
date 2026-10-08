import type { Metadata } from 'next';
import { ApiStatusGate } from '@/components/api-status';
import { SiteHeader } from '@/components/site-header';
import { Playground } from './playground';

export const metadata: Metadata = { title: 'OAuth Playground' };

export default function PlaygroundPage() {
  return (
    <ApiStatusGate>
      <SiteHeader />
      <Playground />
    </ApiStatusGate>
  );
}
