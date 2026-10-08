import type { User } from '../generated/prisma/client';

/** Standard claims released for each scope (OIDC Core §5.4) plus Gatekeeper's `roles` scope. */
export function userClaims(
  user: Pick<User, 'id' | 'email' | 'name' | 'emailVerifiedAt' | 'updatedAt' | 'roles'>,
  scopes: readonly string[],
  clientRoles: string[] = [],
): Record<string, unknown> {
  const claims: Record<string, unknown> = { sub: user.id };
  if (scopes.includes('profile')) {
    claims.name = user.name;
    claims.preferred_username = user.email;
    claims.updated_at = Math.floor(user.updatedAt.getTime() / 1000);
  }
  if (scopes.includes('email')) {
    claims.email = user.email;
    claims.email_verified = Boolean(user.emailVerifiedAt);
  }
  if (scopes.includes('roles')) {
    claims.roles = user.roles.map((r) => r.toLowerCase());
    claims.client_roles = clientRoles;
  }
  return claims;
}

export const CLAIMS_SUPPORTED = [
  'sub',
  'iss',
  'aud',
  'exp',
  'iat',
  'auth_time',
  'nonce',
  'amr',
  'azp',
  'sid',
  'at_hash',
  'name',
  'preferred_username',
  'updated_at',
  'email',
  'email_verified',
  'roles',
  'client_roles',
];

/** Scopes that only make sense with an end-user (not valid for client_credentials). */
export const USER_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access', 'roles']);
