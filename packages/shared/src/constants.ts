/** Scopes defined by OpenID Connect Core / OAuth 2.1 that Gatekeeper always supports. */
export const SYSTEM_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;
export type SystemScope = (typeof SYSTEM_SCOPES)[number];

export const GRANT_TYPES = ['authorization_code', 'refresh_token', 'client_credentials'] as const;
export type GrantType = (typeof GRANT_TYPES)[number];

export const CLIENT_TYPES = ['PUBLIC', 'CONFIDENTIAL'] as const;
export type ClientTypeValue = (typeof CLIENT_TYPES)[number];

export const USER_ROLES = ['ADMIN', 'USER'] as const;
export type UserRoleValue = (typeof USER_ROLES)[number];

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Every security-relevant event recorded in the audit log. */
export const AUDIT_EVENT_TYPES = [
  'user.signup',
  'user.login',
  'user.login_failed',
  'user.locked',
  'user.logout',
  'user.password_changed',
  'user.password_reset_requested',
  'user.password_reset',
  'user.email_verified',
  'user.updated',
  'mfa.enrolled',
  'mfa.disabled',
  'mfa.verified',
  'mfa.failed',
  'mfa.recovery_code_used',
  'mfa.recovery_codes_regenerated',
  'session.revoked',
  'consent.granted',
  'consent.denied',
  'consent.revoked',
  'token.issued',
  'token.refreshed',
  'token.revoked',
  'token.reuse_detected',
  'token.code_reuse_detected',
  'token.exchange_failed',
  'client.created',
  'client.updated',
  'client.deleted',
  'client.secret_rotated',
  'admin.user_locked',
  'admin.user_unlocked',
  'admin.user_mfa_reset',
  'admin.user_roles_changed',
  'admin.sessions_revoked',
  'key.rotated',
  'scope.created',
  'scope.deleted',
  'demo.reset',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
