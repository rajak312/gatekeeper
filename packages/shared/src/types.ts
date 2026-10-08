import type { ClientTypeValue, GrantType, UserRoleValue } from './constants';

/** Standard error body returned by Gatekeeper's JSON APIs. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  details?: unknown;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  roles: UserRoleValue[];
  mfaEnabled: boolean;
  createdAt: string;
  isProtected: boolean;
}

export type LoginResult =
  { status: 'authenticated'; redirectTo: string } | { status: 'mfa_required'; redirectTo: string };

export interface InteractionDetails {
  id: string;
  client: { clientId: string; name: string; description: string | null; logoUrl: string | null };
  scopes: { name: string; description: string; alreadyGranted: boolean }[];
  user: { email: string; name: string } | null;
  redirectUri: string;
}

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  amr: string[];
  current: boolean;
}

export interface AuthorizedApp {
  clientId: string;
  name: string;
  scopes: string[];
  grantedAt: string;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface ClientSummary {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  type: ClientTypeValue;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  allowedScopes: string[];
  grantTypes: GrantType[];
  requireConsent: boolean;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  secretHint: string | null;
  isProtected: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  roles: { id: string; name: string; description: string | null }[];
}

export interface ClientWithSecret {
  client: ClientSummary;
  /** Shown exactly once. Gatekeeper only stores a hash. */
  clientSecret: string | null;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  roles: UserRoleValue[];
  emailVerified: boolean;
  mfaEnabled: boolean;
  locked: boolean;
  disabled: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  isProtected: boolean;
}

export interface AdminUserDetail extends AdminUserSummary {
  failedLoginCount: number;
  disabledReason: string | null;
  sessions: SessionInfo[];
  clientRoles: { id: string; name: string; clientId: string; clientName: string }[];
  apps: AuthorizedApp[];
}

export interface SigningKeyInfo {
  kid: string;
  alg: string;
  status: 'ACTIVE' | 'RETIRED';
  createdAt: string;
  retiredAt: string | null;
  publishUntil: string | null;
  published: boolean;
}

export interface AuditEventInfo {
  id: string;
  /** One of AUDIT_EVENT_TYPES (kept as string so older events stay readable). */
  type: string;
  success: boolean;
  actorId: string | null;
  actorEmail: string | null;
  subjectId: string | null;
  clientId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OutboxEmailInfo {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  template: string;
  createdAt: string;
}

export interface ScopeInfo {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
}

export interface DashboardStats {
  totals: { users: number; clients: number; activeSessions: number; activeGrants: number; mfaUsers: number };
  loginsByDay: { date: string; success: number; failure: number }[];
  recentEvents: AuditEventInfo[];
  securityAlerts24h: number;
  demoMode: boolean;
}
