/**
 * Redirect URI rules (OAuth 2.1 §2.3 / RFC 8252 / Security BCP):
 *  - absolute URI, no fragment, no wildcards
 *  - https, or http only for loopback hosts (localhost / 127.0.0.1 / [::1])
 *  - private-use URI schemes (reverse-DNS, e.g. com.example.app:/cb) for native apps
 * At authorization time the comparison is an exact string match.
 */
export function validateRedirectUri(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return 'must be an absolute URI';
  }
  if (uri.includes('#')) return 'must not contain a fragment';
  if (uri.includes('*')) return 'wildcards are not allowed';
  const scheme = url.protocol.slice(0, -1);
  if (scheme === 'https') return url.hostname ? null : 'must include a host';
  if (scheme === 'http') {
    return isLoopback(url.hostname) ? null : 'http is only allowed for localhost / loopback addresses';
  }
  if (['javascript', 'data', 'file', 'vbscript', 'blob'].includes(scheme))
    return `the ${scheme}: scheme is not allowed`;
  // Private-use scheme for native apps must look like a reverse domain name.
  return /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+$/.test(scheme)
    ? null
    : 'custom schemes must be reverse-DNS style (e.g. com.example.app)';
}

export function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Exact, case-sensitive match against the registered URIs. */
export function redirectUriMatches(requested: string, registered: readonly string[]): boolean {
  return registered.includes(requested);
}

/** Appends OAuth response parameters to a redirect URI, preserving its existing query. */
export function buildRedirect(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return url.toString();
}
