'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { completeCallback, emptyState, saveState } from '../flow';

export default function PlaygroundCallback() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // codes are single-use: never redeem twice under StrictMode
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    completeCallback(params)
      .then(saveState)
      .catch((err: unknown) =>
        saveState({ ...emptyState(), error: err instanceof Error ? err.message : 'Callback failed' }),
      )
      // Drop ?code=... from the address bar and history.
      .finally(() => router.replace('/playground'));
  }, [router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-sm text-muted">
      <Spinner className="size-6 text-brand-500" />
      Exchanging the authorization code…
    </div>
  );
}
