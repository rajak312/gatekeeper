'use client';

import type { InteractionDetails } from '@gatekeeper/shared';
import { AppWindow } from 'lucide-react';
import useSWR from 'swr';

/** "Continue to <App>" banner shown on login/signup/MFA pages during an OAuth flow. */
export function useInteraction(id: string | undefined) {
  return useSWR<InteractionDetails, Error>(id ? `/api/interactions/${encodeURIComponent(id)}` : null);
}

export function ClientBanner({ interaction }: { interaction?: string }) {
  const { data } = useInteraction(interaction);
  if (!interaction || !data) return null;
  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-3 py-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-surface text-brand-600 ring-1 ring-border dark:text-brand-400">
        <AppWindow className="size-4" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="text-subtle">to continue to</p>
        <p className="truncate font-medium text-fg">{data.client.name}</p>
      </div>
    </div>
  );
}
