import type { AdminUserSummary, AuditEventInfo, ClientSummary, SessionInfo, SigningKeyInfo } from '@gatekeeper/shared';
import type { AuditEvent, Client, ClientRole, Session, SigningKey, User } from '../generated/prisma/client';

export function toSessionInfo(s: Session, currentId?: string): SessionInfo {
  return {
    id: s.id,
    ip: s.ip,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    amr: s.amr,
    current: s.id === currentId,
  };
}

export function toAuditInfo(e: AuditEvent): AuditEventInfo {
  return {
    id: e.id,
    type: e.type,
    success: e.success,
    actorId: e.actorId,
    actorEmail: e.actorEmail,
    subjectId: e.subjectId,
    clientId: e.clientId,
    ip: e.ip,
    userAgent: e.userAgent,
    metadata: (e.metadata as Record<string, unknown> | null) ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toClientSummary(c: Client & { roles?: ClientRole[] }): ClientSummary {
  return {
    id: c.id,
    clientId: c.clientId,
    name: c.name,
    description: c.description,
    type: c.type,
    redirectUris: c.redirectUris,
    postLogoutRedirectUris: c.postLogoutRedirectUris,
    allowedScopes: c.allowedScopes,
    grantTypes: c.grantTypes as ClientSummary['grantTypes'],
    requireConsent: c.requireConsent,
    accessTokenTtl: c.accessTokenTtl,
    refreshTokenTtl: c.refreshTokenTtl,
    secretHint: c.secretHint,
    isProtected: c.isProtected,
    disabled: Boolean(c.disabledAt),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    roles: (c.roles ?? []).map((r) => ({ id: r.id, name: r.name, description: r.description })),
  };
}

export function toUserSummary(u: User): AdminUserSummary {
  const locked = Boolean(u.lockedUntil && u.lockedUntil > new Date());
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roles: u.roles,
    emailVerified: Boolean(u.emailVerifiedAt),
    mfaEnabled: Boolean(u.totpEnabledAt),
    locked,
    disabled: Boolean(u.disabledAt),
    lockedUntil: locked ? u.lockedUntil!.toISOString() : null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    isProtected: u.isProtected,
  };
}

export function toKeyInfo(k: SigningKey, now = new Date()): SigningKeyInfo {
  return {
    kid: k.kid,
    alg: k.alg,
    status: k.status,
    createdAt: k.createdAt.toISOString(),
    retiredAt: k.retiredAt?.toISOString() ?? null,
    publishUntil: k.publishUntil?.toISOString() ?? null,
    published: k.status === 'ACTIVE' || Boolean(k.publishUntil && k.publishUntil > now),
  };
}
