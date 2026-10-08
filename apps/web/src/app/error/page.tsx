import { ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard, AuthShell } from '@/components/auth-shell';
import { buttonClasses } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Authorization error' };

export default async function OAuthErrorPage({ searchParams }: PageProps<'/error'>) {
  const p = await searchParams;
  const error = typeof p.error === 'string' ? p.error.slice(0, 64) : 'unknown_error';
  const description =
    typeof p.error_description === 'string'
      ? p.error_description.slice(0, 300)
      : 'Something went wrong while signing you in.';
  // Rendered as text by React (escaped); length-capped to limit content spoofing.
  return (
    <AuthShell>
      <AuthCard
        icon={<ShieldAlert className="size-8 text-amber-500" />}
        title="We couldn’t complete this request"
        subtitle={description}
      >
        <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 font-mono text-xs text-muted">
          error={error}
        </div>
        <p className="mt-4 text-sm text-muted">
          For your safety Gatekeeper never redirects to an application whose identity or redirect URI could not be
          verified.
        </p>
        <Link href="/" className={buttonClasses('secondary', 'lg', 'mt-5 w-full')}>
          Back to Gatekeeper
        </Link>
      </AuthCard>
    </AuthShell>
  );
}
