import { createHash } from 'node:crypto';
import { safeEqual } from '../common/crypto';

/** RFC 7636 §4.1: 43-128 chars from the unreserved set. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A base64url-encoded SHA-256 digest is always exactly 43 characters. */
const S256_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier);
}

export function isValidS256Challenge(challenge: string): boolean {
  return S256_CHALLENGE_RE.test(challenge);
}

export function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * Verifies a PKCE code_verifier against the stored challenge. Only S256 is
 * supported - OAuth 2.1 forbids `plain` when the client can do S256.
 */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  if (!isValidCodeVerifier(verifier)) return false;
  return safeEqual(s256(verifier), challenge);
}
