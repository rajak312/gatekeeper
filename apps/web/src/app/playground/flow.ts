'use client';

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { atHash, randomString, s256 } from '@/lib/pkce';

export const CLIENT_ID = 'playground';
const STORAGE_KEY = 'gatekeeper-playground';

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint: string;
  end_session_endpoint: string;
  scopes_supported: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  refresh_token?: string;
}

export interface TraceEntry {
  id: string;
  at: number;
  title: string;
  method?: string;
  url?: string;
  status?: number;
  ok: boolean;
  detail?: string;
  request?: Record<string, string>;
  response?: unknown;
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export interface PendingRequest {
  verifier: string;
  challenge: string;
  state: string;
  nonce: string;
  scopes: string[];
  startedAt: number;
}

export interface PlaygroundState {
  pending?: PendingRequest;
  tokens?: TokenResponse;
  /** Refresh tokens that were rotated out - kept so the reuse-detection demo can replay one. */
  retiredRefreshTokens: string[];
  checks: Check[];
  userinfo?: unknown;
  idClaims?: JWTPayload;
  trace: TraceEntry[];
  error?: string;
}

export const emptyState = (): PlaygroundState => ({ retiredRefreshTokens: [], checks: [], trace: [] });

export function loadState(): PlaygroundState {
  if (typeof window === 'undefined') return emptyState();
  try {
    return {
      ...emptyState(),
      ...(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<PlaygroundState>),
    };
  } catch {
    return emptyState();
  }
}

/**
 * Tokens live in sessionStorage only so the demo survives the redirect round
 * trip. A production SPA should prefer in-memory storage or a BFF.
 */
export function saveState(state: PlaygroundState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function trace(state: PlaygroundState, entry: Omit<TraceEntry, 'id' | 'at'>): void {
  state.trace.push({ ...entry, id: randomString(6), at: Date.now() });
}

export async function discover(): Promise<Discovery> {
  const res = await fetch('/.well-known/openid-configuration', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Discovery failed (${res.status})`);
  return (await res.json()) as Discovery;
}

export function redirectUri(): string {
  return `${window.location.origin}/playground/callback`;
}

export async function createRequest(scopes: string[]): Promise<PendingRequest> {
  const verifier = randomString(32);
  return {
    verifier,
    challenge: await s256(verifier),
    state: randomString(16),
    nonce: randomString(16),
    scopes,
    startedAt: Date.now(),
  };
}

export function authorizeUrl(d: Discovery, p: PendingRequest, prompt: string): string {
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: p.scopes.join(' '),
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    ...(prompt ? { prompt } : {}),
  }).toString();
  return url.toString();
}

async function postForm(url: string, body: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

export const redact = (v: string) => (v.length > 16 ? `${v.slice(0, 10)}…${v.slice(-4)}` : v);

/** Validates the ID token exactly like a relying party must (OIDC Core §3.1.3.7). */
export async function validateIdToken(
  d: Discovery,
  tokens: TokenResponse,
  nonce: string | null,
): Promise<{ checks: Check[]; claims?: JWTPayload }> {
  const checks: Check[] = [];
  if (!tokens.id_token) return { checks };
  try {
    const jwks = createRemoteJWKSet(new URL(d.jwks_uri));
    const { payload, protectedHeader } = await jwtVerify(tokens.id_token, jwks, {
      issuer: d.issuer,
      audience: CLIENT_ID,
      algorithms: ['RS256'],
    });
    checks.push({
      label: 'Signature',
      ok: true,
      detail: `${protectedHeader.alg} verified with JWKS key ${protectedHeader.kid ?? '?'}`,
    });
    checks.push({ label: 'Issuer & audience', ok: true, detail: `iss = ${payload.iss}, aud = ${String(payload.aud)}` });
    checks.push({
      label: 'Expiry',
      ok: true,
      detail: `valid until ${new Date((payload.exp ?? 0) * 1000).toLocaleTimeString()}`,
    });
    if (nonce !== null) {
      checks.push({
        label: 'Nonce',
        ok: payload.nonce === nonce,
        detail: payload.nonce === nonce ? 'matches the value we sent' : 'MISMATCH - possible replay',
      });
    }
    const expected = await atHash(tokens.access_token);
    checks.push({
      label: 'at_hash',
      ok: payload.at_hash === expected,
      detail: payload.at_hash === expected ? 'binds the access token to this ID token' : 'MISMATCH',
    });
    return { checks, claims: payload };
  } catch (err) {
    checks.push({ label: 'Signature', ok: false, detail: err instanceof Error ? err.message : 'verification failed' });
    return { checks };
  }
}

/** Handles the redirect back from Gatekeeper: state/iss checks, then the PKCE code exchange. */
export async function completeCallback(params: URLSearchParams): Promise<PlaygroundState> {
  const state = loadState();
  const pending = state.pending;
  state.checks = [];
  const d = await discover();
  trace(state, {
    title: 'Redirect back to the app',
    method: 'GET',
    url: `/playground/callback?${[...params.keys()].join('&')}`,
    ok: !params.has('error'),
    request: Object.fromEntries([...params].map(([k, v]) => [k, k === 'code' ? redact(v) : v])),
  });

  if (params.get('error')) {
    state.error = `${params.get('error')}: ${params.get('error_description') ?? ''}`;
    delete state.pending;
    return state;
  }
  if (!pending) {
    state.error = 'No pending authorization request found in this browser tab (start again).';
    return state;
  }
  const stateOk = params.get('state') === pending.state;
  state.checks.push({
    label: 'State',
    ok: stateOk,
    detail: stateOk ? 'matches - not a forged (CSRF) callback' : 'MISMATCH - rejected',
  });
  const issOk = params.get('iss') === d.issuer;
  state.checks.push({
    label: 'Issuer (RFC 9207)',
    ok: issOk,
    detail: issOk ? 'iss parameter matches discovery - no mix-up' : 'MISMATCH',
  });
  if (!stateOk || !issOk) {
    state.error = 'Callback validation failed - the code was not redeemed.';
    delete state.pending;
    return state;
  }

  const body = {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: params.get('code') ?? '',
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  };
  const res = await postForm(d.token_endpoint, body);
  trace(state, {
    title: 'Exchange code + PKCE verifier for tokens',
    method: 'POST',
    url: new URL(d.token_endpoint).pathname,
    status: res.status,
    ok: res.status === 200,
    request: { ...body, code: redact(body.code), code_verifier: redact(body.code_verifier) },
    response: res.status === 200 ? summarizeTokens(res.json as TokenResponse) : res.json,
  });
  if (res.status !== 200) {
    state.error = `Token exchange failed: ${JSON.stringify(res.json)}`;
    delete state.pending;
    return state;
  }
  state.checks.push({
    label: 'PKCE (S256)',
    ok: true,
    detail: 'server verified SHA-256(code_verifier) = code_challenge',
  });
  state.tokens = res.json as TokenResponse;
  state.retiredRefreshTokens = [];
  const validation = await validateIdToken(d, state.tokens, pending.nonce);
  state.checks.push(...validation.checks);
  state.idClaims = validation.claims;
  trace(state, {
    title: 'Verify ID token against JWKS',
    method: 'GET',
    url: new URL(d.jwks_uri).pathname,
    ok: validation.checks.every((c) => c.ok),
    detail: validation.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.label}`).join('  '),
  });
  await callUserinfo(state, d);
  delete state.pending;
  delete state.error;
  return state;
}

export function summarizeTokens(t: TokenResponse): Record<string, unknown> {
  return {
    token_type: t.token_type,
    expires_in: t.expires_in,
    scope: t.scope,
    access_token: redact(t.access_token),
    ...(t.id_token ? { id_token: redact(t.id_token) } : {}),
    ...(t.refresh_token ? { refresh_token: redact(t.refresh_token) } : {}),
  };
}

export async function callUserinfo(state: PlaygroundState, d: Discovery): Promise<void> {
  if (!state.tokens) return;
  const res = await fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${state.tokens.access_token}` } });
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) state.userinfo = json;
  trace(state, {
    title: 'Call the userinfo endpoint',
    method: 'GET',
    url: new URL(d.userinfo_endpoint).pathname,
    status: res.status,
    ok: res.ok,
    response: json,
    request: { Authorization: `Bearer ${redact(state.tokens.access_token)}` },
  });
}

export async function refreshTokens(state: PlaygroundState, d: Discovery): Promise<void> {
  if (!state.tokens?.refresh_token) return;
  const old = state.tokens.refresh_token;
  const res = await postForm(d.token_endpoint, {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: old,
  });
  const ok = res.status === 200;
  trace(state, {
    title: ok ? 'Refresh - token rotated' : 'Refresh failed',
    method: 'POST',
    url: new URL(d.token_endpoint).pathname,
    status: res.status,
    ok,
    request: { grant_type: 'refresh_token', refresh_token: redact(old) },
    response: ok ? summarizeTokens(res.json as TokenResponse) : res.json,
    detail: ok ? `old refresh token ${redact(old)} is now single-use spent` : undefined,
  });
  if (ok) {
    state.retiredRefreshTokens.push(old);
    state.tokens = res.json as TokenResponse;
    const v = await validateIdToken(d, state.tokens, null);
    state.idClaims = v.claims ?? state.idClaims;
  }
}

/** Replays a rotated-out refresh token, triggering reuse detection on the server. */
export async function replayOldRefreshToken(state: PlaygroundState, d: Discovery): Promise<void> {
  const old = state.retiredRefreshTokens[0];
  if (!old) return;
  const res = await postForm(d.token_endpoint, {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: old,
  });
  trace(state, {
    title: 'Attacker replays a stolen (old) refresh token',
    method: 'POST',
    url: new URL(d.token_endpoint).pathname,
    status: res.status,
    ok: res.status !== 200,
    request: { grant_type: 'refresh_token', refresh_token: redact(old) },
    response: res.json,
    detail:
      res.status !== 200
        ? 'Reuse detected → the server revoked the entire token family, including the current tokens.'
        : undefined,
  });
}

export async function revokeAccessToken(state: PlaygroundState, d: Discovery): Promise<void> {
  if (!state.tokens) return;
  const res = await postForm(d.revocation_endpoint, {
    client_id: CLIENT_ID,
    token: state.tokens.access_token,
    token_type_hint: 'access_token',
  });
  trace(state, {
    title: 'Revoke the access token (RFC 7009)',
    method: 'POST',
    url: new URL(d.revocation_endpoint).pathname,
    status: res.status,
    ok: res.status === 200,
    request: { token: redact(state.tokens.access_token), token_type_hint: 'access_token' },
  });
}

export function logoutUrl(d: Discovery, idToken: string | undefined): string {
  const url = new URL(d.end_session_endpoint);
  url.search = new URLSearchParams({
    ...(idToken ? { id_token_hint: idToken } : { client_id: CLIENT_ID }),
    post_logout_redirect_uri: `${window.location.origin}/playground`,
    state: randomString(8),
  }).toString();
  return url.toString();
}
