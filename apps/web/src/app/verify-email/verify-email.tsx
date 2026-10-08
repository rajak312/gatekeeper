'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/auth-shell';
import { buttonClasses } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';

export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<{ status: 'pending' | 'ok' | 'error'; message?: string }>({
    status: token ? 'pending' : 'error',
    message: 'Missing token',
  });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // tokens are single-use; don't double-submit in StrictMode
    api('/api/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => setState({ status: 'ok' }))
      .catch((err: unknown) => setState({ status: 'error', message: errorMessage(err) }));
  }, [token]);

  if (state.status === 'pending') {
    return (
      <AuthCard title="Verifying your email…">
        <Spinner className="size-6 text-brand-500" />
      </AuthCard>
    );
  }
  return state.status === 'ok' ? (
    <AuthCard
      icon={<CheckCircle2 className="size-8 text-emerald-500" />}
      title="Email verified"
      subtitle="Apps you sign in to will now see email_verified: true."
    >
      <Link href="/account" className={buttonClasses('primary', 'lg', 'w-full')}>
        Go to your account
      </Link>
    </AuthCard>
  ) : (
    <AuthCard icon={<XCircle className="size-8 text-red-500" />} title="Verification failed" subtitle={state.message}>
      <Link href="/account" className={buttonClasses('secondary', 'lg', 'w-full')}>
        Request a new link from your account
      </Link>
    </AuthCard>
  );
}
