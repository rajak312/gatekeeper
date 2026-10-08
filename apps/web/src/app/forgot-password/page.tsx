'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthCard, AuthShell } from '@/components/auth-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      footer={
        <Link href="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <AuthCard
          icon={<MailCheck className="size-8 text-emerald-500" />}
          title="Check your inbox"
          subtitle={
            <>
              If an account exists for <b>{email}</b>, we sent a link to reset your password. It expires in 30 minutes.
            </>
          }
        >
          <Alert tone="info" title="Demo note">
            There is no real email delivery in this demo - messages are stored in the <b>dev outbox</b> of the admin
            console.
          </Alert>
        </AuthCard>
      ) : (
        <AuthCard title="Reset your password" subtitle="Enter your email and we'll send you a reset link.">
          <form onSubmit={submit} className="space-y-4">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Send reset link
            </Button>
          </form>
        </AuthCard>
      )}
    </AuthShell>
  );
}
