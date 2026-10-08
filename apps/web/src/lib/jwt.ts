export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  parts: [string, string, string];
}

function b64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const bin = atob(input.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Decodes (does NOT verify) a compact JWS. Verification is done separately with jose + JWKS. */
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(b64urlDecode(parts[0]!)) as Record<string, unknown>,
      payload: JSON.parse(b64urlDecode(parts[1]!)) as Record<string, unknown>,
      signature: parts[2]!,
      parts: parts as [string, string, string],
    };
  } catch {
    return null;
  }
}

/** Human explanations for registered and Gatekeeper claims, shown in the playground. */
export const CLAIM_DESCRIPTIONS: Record<string, string> = {
  iss: 'Issuer - who created and signed this token',
  sub: 'Subject - stable identifier of the user (or client)',
  aud: 'Audience - who the token is intended for',
  azp: 'Authorized party - the client the token was issued to',
  exp: 'Expiration time',
  iat: 'Issued at',
  auth_time: 'When the user actually authenticated',
  nonce: 'Echo of the nonce sent in the request (replay protection)',
  at_hash: 'Hash of the access token - binds it to this ID token',
  amr: 'Authentication methods used (pwd = password, otp = TOTP, mfa = multi-factor)',
  sid: 'Session ID at the identity provider',
  jti: 'Unique token ID - used for revocation',
  scope: 'Granted scopes',
  client_id: 'Client the token was issued to',
  roles: 'Global roles of the user',
  resource_access: 'Per-client roles (Keycloak-style)',
  client_roles: 'Roles for this client',
  email: 'Email address',
  email_verified: 'Whether the email address was verified',
  name: 'Full name',
  preferred_username: 'Username',
  updated_at: 'When the profile was last updated',
};

export const TIME_CLAIMS = new Set(['exp', 'iat', 'auth_time', 'nbf', 'updated_at']);
