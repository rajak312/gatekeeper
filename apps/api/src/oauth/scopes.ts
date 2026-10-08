/** Splits a space-delimited scope string (RFC 6749 §3.3), de-duplicating. */
export function parseScope(scope: string | undefined | null): string[] {
  if (!scope) return [];
  return [...new Set(scope.split(' ').filter(Boolean))];
}

export function formatScope(scopes: readonly string[]): string {
  return scopes.join(' ');
}

const SCOPE_TOKEN_RE = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

export type ScopeCheck = { ok: true; scopes: string[] } | { ok: false; invalid: string[] };

/**
 * Validates requested scopes against what the client is allowed and what the
 * server knows about. Unknown or disallowed scopes are an `invalid_scope` error
 * rather than being silently dropped, so misconfiguration is visible.
 */
export function checkScopes(
  requested: readonly string[],
  clientAllowed: readonly string[],
  serverKnown: ReadonlySet<string>,
): ScopeCheck {
  const invalid = requested.filter((s) => !SCOPE_TOKEN_RE.test(s) || !clientAllowed.includes(s) || !serverKnown.has(s));
  return invalid.length ? { ok: false, invalid } : { ok: true, scopes: [...requested] };
}

/** True if every scope in `subset` is contained in `superset`. */
export function isSubset(subset: readonly string[], superset: readonly string[]): boolean {
  return subset.every((s) => superset.includes(s));
}

/** Scopes from `requested` that the user has not yet consented to. */
export function missingConsent(requested: readonly string[], granted: readonly string[]): string[] {
  return requested.filter((s) => !granted.includes(s));
}
