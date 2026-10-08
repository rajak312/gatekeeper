'use client';

import { Sparkles } from 'lucide-react';

export const DEMO_ACCOUNTS = [
  { label: 'Demo user', email: 'demo@gatekeeper.dev', password: 'demo1234' },
  { label: 'Admin', email: 'admin@gatekeeper.dev', password: 'admin1234' },
] as const;

export function DemoCredentials({ onPick }: { onPick: (email: string, password: string) => void }) {
  if (process.env.NEXT_PUBLIC_HIDE_DEMO_CREDENTIALS === 'true') return null;
  return (
    <div className="mt-5 rounded-xl border border-dashed border-brand-300/70 bg-brand-50/50 p-3 dark:border-brand-800/70 dark:bg-brand-950/20">
      <p className="flex items-center gap-1.5 text-xs font-medium text-brand-700 dark:text-brand-300">
        <Sparkles className="size-3.5" /> Try it with a demo account
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.email}
            type="button"
            onClick={() => onPick(a.email, a.password)}
            className="cursor-pointer rounded-lg border border-border bg-surface px-2.5 py-2 text-left transition hover:border-brand-400 hover:shadow-sm"
          >
            <span className="block text-xs font-semibold text-fg">{a.label}</span>
            <span className="block truncate font-mono text-[11px] text-subtle">{a.email}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
