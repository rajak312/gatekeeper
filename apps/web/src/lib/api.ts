'use client';

import type { ApiErrorBody } from '@gatekeeper/shared';

/** Error thrown for non-2xx responses from the Gatekeeper API. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const CSRF_COOKIES = ['__Host-gk_csrf', 'gk_csrf'];

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name && CSRF_COOKIES.includes(name)) return decodeURIComponent(rest.join('='));
  }
  return null;
}

let csrfPromise: Promise<string> | null = null;

/** Double-submit CSRF token: the API sets a cookie, we echo it in a header. */
async function csrfToken(): Promise<string> {
  const existing = readCsrfCookie();
  if (existing) return existing;
  csrfPromise ??= fetch('/api/auth/csrf', { credentials: 'same-origin' })
    .then((r) => r.json() as Promise<{ csrfToken: string }>)
    .then((b) => b.csrfToken)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> & { error_description?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* non-JSON error (e.g. proxy timeout while the API wakes up) */
  }
  const message =
    body.message ??
    body.error_description ??
    (res.status >= 502 ? 'The server is starting up. Please try again in a moment.' : res.statusText);
  return new ApiError(
    res.status,
    body.code ?? (typeof body.error === 'string' ? body.error : undefined),
    String(message),
    body.details,
  );
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await csrfToken();
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const fetcher = <T>(path: string): Promise<T> => api<T>(path);

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
