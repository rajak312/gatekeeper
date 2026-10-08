'use client';

import { PASSWORD_MIN_LENGTH, signupSchema, type LoginResult } from '@gatekeeper/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-shell';
import { ClientBanner } from '@/components/client-banner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= PASSWORD_MIN_LENGTH) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return { score, label: ['Too short', 'Weak', 'Okay', 'Good', 'Strong'][score]! };
}

export function SignupForm({ interaction }: { interaction?: string }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const s = strength(form.password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const res = await api<LoginResult>('/api/auth/signup', { method: 'POST', body: { ...parsed.data, interaction } });
      window.location.assign(res.redirectTo);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const suffix = interaction ? `?interaction=${encodeURIComponent(interaction)}` : '';

  return (
    <>
      <AuthCard title="Create your account" subtitle="One account for every app that uses Gatekeeper.">
        <ClientBanner interaction={interaction} />
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Full name" htmlFor="name" error={errors.name}>
            <Input
              id="name"
              autoComplete="name"
              autoFocus
              value={form.name}
              onChange={set('name')}
              aria-invalid={Boolean(errors.name)}
            />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
              aria-invalid={Boolean(errors.email)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            error={errors.password}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. Passphrases work great.`}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              aria-invalid={Boolean(errors.password)}
            />
          </Field>
          {form.password ? (
            <div className="flex items-center gap-2" aria-live="polite">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1 flex-1 rounded-full bg-surface-2',
                      i < s.score && (s.score <= 1 ? 'bg-red-500' : s.score === 2 ? 'bg-amber-500' : 'bg-emerald-500'),
                    )}
                  />
                ))}
              </div>
              <span className="w-16 text-right text-xs text-subtle">{s.label}</span>
            </div>
          ) : null}
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Create account
          </Button>
          <p className="text-center text-xs text-subtle">
            We&apos;ll send a verification link. In this demo, emails land in the admin console&apos;s dev outbox.
          </p>
        </form>
      </AuthCard>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href={`/login${suffix}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Sign in
        </Link>
      </p>
    </>
  );
}
