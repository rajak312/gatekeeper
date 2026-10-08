'use client';

import type { LoginResult } from '@gatekeeper/shared';
import { KeyRound, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { AuthCard } from '@/components/auth-shell';
import { ClientBanner } from '@/components/client-banner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

/** Six single-digit boxes with paste support. */
function OtpInput({
  value,
  onChange,
  onComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  const update = (next: string) => {
    onChange(next);
    if (next.length === 6) onComplete(next);
  };
  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={i === 0}
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          value={d.trim()}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, '').slice(-1);
            if (!ch) return;
            const next = (value.slice(0, i) + ch).slice(0, 6);
            update(next);
            refs.current[Math.min(i + 1, 5)]?.focus();
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              onChange(value.slice(0, Math.max(0, value.length - 1)));
              refs.current[Math.max(0, i - 1)]?.focus();
            }
          }}
          onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (pasted) {
              update(pasted);
              refs.current[Math.min(pasted.length, 5)]?.focus();
            }
          }}
          className="h-12 w-full min-w-0 rounded-lg border border-border bg-surface text-center font-mono text-lg font-semibold text-fg shadow-xs focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none"
        />
      ))}
    </div>
  );
}

export function MfaForm({ interaction }: { interaction?: string }) {
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<{ message: string; expired: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  async function verify(body: { code?: string; recoveryCode?: string }) {
    setError(null);
    setLoading(true);
    try {
      const res = await api<LoginResult>('/api/auth/mfa', { method: 'POST', body: { ...body, interaction } });
      window.location.assign(res.redirectTo);
    } catch (err) {
      const expired = err instanceof ApiError && err.code === 'mfa_session_expired';
      setError({ message: err instanceof Error ? err.message : 'Verification failed', expired });
      setCode('');
      setLoading(false);
    }
  }

  const loginHref = `/login${interaction ? `?interaction=${encodeURIComponent(interaction)}` : ''}`;

  return (
    <AuthCard
      icon={
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-800/60">
          {mode === 'totp' ? <Smartphone className="size-5" /> : <KeyRound className="size-5" />}
        </span>
      }
      title="Two-factor authentication"
      subtitle={
        mode === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of the recovery codes you saved when enabling MFA.'
      }
    >
      <ClientBanner interaction={interaction} />
      <div className="space-y-4">
        {error ? (
          <Alert tone="danger">
            {error.message}{' '}
            {error.expired ? (
              <Link href={loginHref} className="font-medium underline">
                Sign in again
              </Link>
            ) : null}
          </Alert>
        ) : null}
        {mode === 'totp' ? (
          <>
            <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify({ code: c })} />
            <Button
              size="lg"
              className="w-full"
              loading={loading}
              disabled={code.length !== 6}
              onClick={() => void verify({ code })}
            >
              Verify
            </Button>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void verify({ recoveryCode: recovery });
            }}
          >
            <Field label="Recovery code" htmlFor="recovery">
              <Input
                id="recovery"
                autoFocus
                placeholder="xxxx-xxxx-xxxx"
                className="font-mono"
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
              />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={loading} disabled={recovery.trim().length < 8}>
              Verify recovery code
            </Button>
          </form>
        )}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'totp' ? 'recovery' : 'totp');
            setError(null);
          }}
          className="w-full cursor-pointer text-center text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          {mode === 'totp' ? 'Lost your device? Use a recovery code' : 'Use your authenticator app instead'}
        </button>
      </div>
    </AuthCard>
  );
}
