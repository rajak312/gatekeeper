import type { AuditEventInfo } from '@gatekeeper/shared';
import {
  AppWindow,
  KeyRound,
  LogIn,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Ticket,
  UserCog,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { timeAgo, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from './ui/badge';

const LABELS: Record<string, string> = {
  'user.signup': 'Signed up',
  'user.login': 'Signed in',
  'user.login_failed': 'Failed sign-in',
  'user.locked': 'Account locked (brute force)',
  'user.logout': 'Signed out',
  'user.password_changed': 'Password changed',
  'user.password_reset_requested': 'Password reset requested',
  'user.password_reset': 'Password reset',
  'user.email_verified': 'Email verified',
  'user.updated': 'Profile updated',
  'mfa.enrolled': 'MFA enabled',
  'mfa.disabled': 'MFA disabled',
  'mfa.verified': 'MFA code accepted',
  'mfa.failed': 'Invalid MFA code',
  'mfa.recovery_code_used': 'Recovery code used',
  'mfa.recovery_codes_regenerated': 'Recovery codes regenerated',
  'session.revoked': 'Session revoked',
  'consent.granted': 'Consent granted',
  'consent.denied': 'Consent denied',
  'consent.revoked': 'App access revoked',
  'token.issued': 'Tokens issued',
  'token.refreshed': 'Tokens refreshed',
  'token.revoked': 'Token revoked',
  'token.reuse_detected': 'Refresh token reuse detected',
  'token.code_reuse_detected': 'Authorization code replay',
  'token.exchange_failed': 'Code exchange rejected',
  'client.created': 'Application created',
  'client.updated': 'Application updated',
  'client.deleted': 'Application deleted',
  'client.secret_rotated': 'Client secret rotated',
  'admin.user_locked': 'User locked by admin',
  'admin.user_unlocked': 'User unlocked by admin',
  'admin.user_mfa_reset': 'MFA reset by admin',
  'admin.user_roles_changed': 'Roles changed',
  'admin.sessions_revoked': 'Sessions revoked by admin',
  'key.rotated': 'Signing key rotated',
  'scope.created': 'Scope created',
  'scope.deleted': 'Scope deleted',
  'demo.reset': 'Demo data reset',
};

export const AUDIT_GROUPS = [
  { value: '', label: 'All events' },
  { value: 'user.', label: 'Accounts' },
  { value: 'user.login_failed', label: '· Failed sign-ins' },
  { value: 'mfa.', label: 'MFA' },
  { value: 'token.', label: 'Tokens' },
  { value: 'token.reuse_detected', label: '· Token reuse detected' },
  { value: 'consent.', label: 'Consent' },
  { value: 'client.', label: 'Applications' },
  { value: 'admin.', label: 'Admin actions' },
  { value: 'key.', label: 'Signing keys' },
];

const ICONS: [test: (t: string) => boolean, icon: LucideIcon][] = [
  [(t) => t.includes('reuse') || t === 'user.locked', ShieldAlert],
  [(t) => t === 'user.login' || t === 'user.login_failed', LogIn],
  [(t) => t === 'user.logout' || t === 'session.revoked', LogOut],
  [(t) => t === 'user.signup', UserPlus],
  [(t) => t.startsWith('mfa.'), Smartphone],
  [(t) => t.startsWith('token.'), Ticket],
  [(t) => t.startsWith('client.') || t.startsWith('consent.'), AppWindow],
  [(t) => t.startsWith('key.'), KeyRound],
  [(t) => t.startsWith('admin.'), UserCog],
];

function EventIcon({ type }: { type: string }) {
  const Icon = ICONS.find(([test]) => test(type))?.[1] ?? ShieldCheck;
  return <Icon className="size-3.5" />;
}

export function auditLabel(type: string): string {
  return LABELS[type] ?? type;
}

export function AuditEventRow({ event, compact }: { event: AuditEventInfo; compact?: boolean }) {
  const critical = event.type.includes('reuse') || event.type === 'user.locked';
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1',
          critical
            ? 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-950/40 dark:text-red-400 dark:ring-red-900/60'
            : event.success
              ? 'bg-surface-2 text-muted ring-border'
              : 'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900/60',
        )}
      >
        <EventIcon type={event.type} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-fg">{auditLabel(event.type)}</span>
          {critical ? (
            <Badge tone="danger">security</Badge>
          ) : !event.success ? (
            <Badge tone="warning">failed</Badge>
          ) : null}
          {event.clientId ? <Badge>{event.clientId}</Badge> : null}
        </p>
        <p className="truncate text-xs text-subtle">
          {event.actorEmail ?? 'system'}
          {!compact && event.ip ? ` · ${event.ip}` : ''}
          {!compact ? <span className="font-mono"> · {event.type}</span> : null}
        </p>
      </div>
      <time className="shrink-0 text-xs text-subtle" title={formatDateTime(event.createdAt)} dateTime={event.createdAt}>
        {timeAgo(event.createdAt)}
      </time>
    </div>
  );
}
