'use client';

import { Coffee } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { LogoMark } from './logo';

type Status = 'checking' | 'waking' | 'up';

/** Pings /health until the API answers. Free Render instances sleep after inactivity (~30-60s cold start). */
export async function waitForApi(signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    try {
      const res = await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (res.ok) return;
    } catch {
      /* still asleep */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

/**
 * Renders children once the API is reachable. While a cold API boots, shows a
 * friendly "waking up" screen instead of a broken page. Fast APIs never see it.
 */
export function ApiStatusGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const slow = setTimeout(() => setStatus((s) => (s === 'checking' ? 'waking' : s)), 1500);
    void waitForApi(ctrl.signal).then(() => setStatus('up'));
    return () => {
      ctrl.abort();
      clearTimeout(slow);
    };
  }, []);

  useEffect(() => {
    if (status !== 'waking') return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  if (status === 'up') return <>{children}</>;
  if (status === 'checking') return <div className="min-h-dvh" />;
  return <WakingUp elapsed={elapsed} />;
}

export function WakingUp({ elapsed }: { elapsed: number }) {
  const progress = Math.min(95, (elapsed / 60) * 100);
  return (
    <div className="bg-grid flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm animate-fade-in rounded-2xl border border-border bg-surface p-8 text-center shadow-xl">
        <div className="relative mx-auto mb-5 w-fit">
          <LogoMark className="size-12 rounded-xl" />
          <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-amber-400 text-amber-950">
            <Coffee className="size-3" />
          </span>
        </div>
        <h1 className="text-lg font-semibold">Waking up the server…</h1>
        <p className="mt-2 text-sm text-muted">
          This demo runs on a free instance that sleeps when idle. The first request takes up to a minute - thanks for
          your patience.
        </p>
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-xs text-subtle">{elapsed}s</p>
      </div>
    </div>
  );
}
