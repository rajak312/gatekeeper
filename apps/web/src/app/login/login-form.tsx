'use client';

import type { LoginResult } from '@gatekeeper/shared';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-shell';
import { ClientBanner } from '@/components/client-banner';
import { DemoCredentials } from '@/components/demo-credentials';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useMe } from '@/lib/hooks';

export function LoginForm({ interaction, reauth, next }: { interaction?: string; reauth: boolean; next?: string }) {
  const router = useRouter();
  const { data: me } = useMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Already signed in and not in an OAuth flow: go to the account page.
  useEffect(() => {
    if (me && !interaction) router.replace(next ?? '/account');
  }, [me, interaction, router, next]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<LoginResult>('/api/auth/login', { method: 'POST', body: { email, password, interaction } });
      // /oauth/authorize/resume is an API redirect, so use a full navigation.
      window.location.assign(res.status === 'authenticated' && !interaction && next ? next : res.redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
      setLoading(false);
    }
  }

  const suffix = interaction ? `?interaction=${encodeURIComponent(interaction)}` : '';

  return (
    <>
      <AuthCard
        title={reauth ? 'Confirm it’s you' : 'Sign in'}
        subtitle={
          reauth ? 'The application asked you to sign in again.' : 'Welcome back. Sign in to your Gatekeeper account.'
        }
      >
        <ClientBanner interaction={interaction} />
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            action={
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Forgot password?
              </Link>
            }
          >
            <div className="relative">
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-subtle hover:text-fg"
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Continue
          </Button>
        </form>
        <DemoCredentials
          onPick={(e, p) => {
            setEmail(e);
            setPassword(p);
          }}
        />
      </AuthCard>
      <p className="mt-6 text-center text-sm text-muted">
        Don&apos;t have an account?{' '}
        <Link href={`/signup${suffix}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Create one
        </Link>
      </p>
    </>
  );
}
