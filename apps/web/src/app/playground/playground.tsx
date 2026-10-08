'use client';

import {
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronRight,
  Fingerprint,
  LogOut,
  RefreshCw,
  RotateCcw,
  Siren,
  User,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { waitForApi } from '@/components/api-status';
import { JsonView } from '@/components/json-view';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Checkbox, Select } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { decodeJwt } from '@/lib/jwt';
import {
  authorizeUrl,
  callUserinfo,
  clearState,
  createRequest,
  discover,
  emptyState,
  loadState,
  logoutUrl,
  redirectUri,
  refreshTokens,
  replayOldRefreshToken,
  revokeAccessToken,
  saveState,
  trace,
  type Discovery,
  type PlaygroundState,
} from './flow';
import { JwtView } from './token-view';

const SCOPE_OPTIONS = [
  { name: 'openid', note: 'Required for OpenID Connect - returns an ID token', locked: true },
  { name: 'profile', note: 'name, preferred_username' },
  { name: 'email', note: 'email, email_verified' },
  { name: 'offline_access', note: 'Issues a rotating refresh token' },
  { name: 'roles', note: 'Global and per-client roles as claims' },
  { name: 'api:read', note: 'Custom API scope' },
];

const STEPS = [
  {
    title: 'Authorization request',
    body: 'The app generates a PKCE verifier, state and nonce, then redirects you to Gatekeeper.',
  },
  {
    title: 'Sign in & consent',
    body: 'Gatekeeper authenticates you (password, then TOTP if enabled) and asks you to approve the scopes.',
  },
  { title: 'Code exchange', body: 'The app trades the one-time code + verifier for tokens at the token endpoint.' },
  { title: 'Verify & use', body: 'The ID token is verified against the JWKS; the access token calls userinfo.' },
];

type Tab = 'id' | 'access' | 'userinfo' | 'response';

export function Playground() {
  // Rendered client-only (inside ApiStatusGate), so sessionStorage is available here.
  const [state, setState] = useState<PlaygroundState>(() => loadState());
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [scopes, setScopes] = useState<string[]>(['openid', 'profile', 'email', 'offline_access', 'roles']);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('id');

  useEffect(() => {
    discover()
      .then(setDiscovery)
      .catch(() => setDiscovery(null));
  }, []);

  // Live preview of the authorization URL (with placeholder PKCE values).
  const preview = useMemo(() => {
    if (!discovery) return '';
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: 'playground',
      redirect_uri: redirectUri(),
      scope: scopes.join(' '),
      state: '<random>',
      nonce: '<random>',
      code_challenge: '<SHA-256(verifier)>',
      code_challenge_method: 'S256',
      ...(prompt ? { prompt } : {}),
    }).toString();
    return decodeURIComponent(url.toString());
  }, [discovery, scopes, prompt]);

  async function run(label: string, fn: (s: PlaygroundState, d: Discovery) => Promise<void>) {
    if (!discovery) return;
    setBusy(label);
    const next = structuredClone(state);
    try {
      await fn(next, discovery);
    } catch (err) {
      trace(next, { title: `${label} failed`, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
    saveState(next);
    setState(next);
    setBusy(null);
  }

  async function signIn() {
    if (!discovery) return;
    setBusy('signin');
    await waitForApi();
    const pending = await createRequest(scopes);
    const next: PlaygroundState = { ...emptyState(), pending };
    trace(next, {
      title: 'Discover the provider',
      method: 'GET',
      url: '/.well-known/openid-configuration',
      status: 200,
      ok: true,
      detail: `issuer = ${discovery.issuer}`,
    });
    trace(next, {
      title: 'Redirect to the authorization endpoint',
      method: 'GET',
      url: new URL(discovery.authorization_endpoint).pathname,
      ok: true,
      request: {
        response_type: 'code',
        client_id: 'playground',
        scope: scopes.join(' '),
        code_challenge: pending.challenge,
        code_challenge_method: 'S256',
        state: pending.state,
        nonce: pending.nonce,
        ...(prompt ? { prompt } : {}),
      },
      detail: 'code_verifier stays in the browser; only its SHA-256 hash is sent.',
    });
    saveState(next);
    window.location.assign(authorizeUrl(discovery, pending, prompt));
  }

  function reset() {
    clearState();
    setState(emptyState());
  }

  const tokens = state.tokens;
  const access = useMemo(() => (tokens ? decodeJwt(tokens.access_token) : null), [tokens]);
  const lastReuse = [...state.trace].reverse().find((t) => t.title.startsWith('Attacker replays'));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">OAuth Playground</h1>
            <Badge tone="brand">Authorization Code + PKCE</Badge>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            This page is a real relying party - a public single-page app registered as client{' '}
            <code className="font-mono text-fg">playground</code>. Sign in through Gatekeeper and inspect every step of
            the protocol.
          </p>
        </div>
        {tokens || state.error ? (
          <Button variant="secondary" onClick={reset}>
            <RotateCcw className="size-4" /> Start over
          </Button>
        ) : null}
      </div>

      {state.error ? (
        <Alert tone="danger" title="The flow did not complete" className="mb-6">
          <span className="font-mono text-xs">{state.error}</span>
        </Alert>
      ) : null}

      {!tokens ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Card>
            <CardHeader title="1. Configure the request" description="Choose the scopes the app asks for." />
            <CardBody className="space-y-3.5">
              {SCOPE_OPTIONS.map((s) => (
                <Checkbox
                  key={s.name}
                  id={`scope-${s.name}`}
                  checked={scopes.includes(s.name)}
                  disabled={s.locked}
                  onChange={(on) => setScopes((cur) => (on ? [...cur, s.name] : cur.filter((x) => x !== s.name)))}
                  label={<span className="font-mono text-[13px]">{s.name}</span>}
                  description={s.note}
                />
              ))}
              <div className="pt-2">
                <label htmlFor="prompt" className="text-sm font-medium">
                  prompt
                </label>
                <Select id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mt-1.5">
                  <option value="">(default) - reuse session &amp; remembered consent</option>
                  <option value="consent">consent - always show the consent screen</option>
                  <option value="login">login - force re-authentication</option>
                  <option value="none">none - silent auth, error if interaction needed</option>
                </Select>
              </div>
              <Button
                size="lg"
                className="mt-2 w-full"
                onClick={() => void signIn()}
                loading={busy === 'signin'}
                disabled={!discovery}
              >
                <Fingerprint className="size-4" /> Sign in with Gatekeeper
              </Button>
              <p className="text-center text-xs text-subtle">
                Demo account: <span className="font-mono">demo@gatekeeper.dev</span> /{' '}
                <span className="font-mono">demo1234</span>
              </p>
            </CardBody>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Authorization request preview" actions={<CopyButton value={preview} />} />
              <CardBody>
                <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-300 dark:bg-black/50">
                  {preview ? preview.replace('?', '\n  ?').split('&').join('\n  &') : 'Loading discovery document…'}
                </pre>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="What happens next" />
              <CardBody>
                <ol className="relative space-y-5 border-l border-border pl-6">
                  {STEPS.map((s, i) => (
                    <li key={s.title}>
                      <span className="absolute -left-3 flex size-6 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-brand-600 dark:text-brand-400">
                        {i + 1}
                      </span>
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="text-sm text-muted">{s.body}</p>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader
                title="Security checks"
                description="Everything a relying party must validate."
                actions={
                  state.checks.every((c) => c.ok) ? (
                    <Badge tone="success" dot>
                      all passed
                    </Badge>
                  ) : (
                    <Badge tone="danger" dot>
                      failed
                    </Badge>
                  )
                }
              />
              <ul className="divide-y divide-border">
                {state.checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-2.5 px-5 py-2.5">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="text-xs break-words text-subtle">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Try it" description="Each action calls Gatekeeper and is logged in the trace." />
              <CardBody className="space-y-2.5">
                <ActionButton
                  icon={User}
                  label="Call userinfo"
                  busy={busy === 'userinfo'}
                  onClick={() => void run('userinfo', callUserinfo)}
                />
                <ActionButton
                  icon={RefreshCw}
                  label="Refresh tokens (rotation)"
                  busy={busy === 'refresh'}
                  disabled={!tokens.refresh_token}
                  hint={!tokens.refresh_token ? 'Request offline_access to get a refresh token' : undefined}
                  onClick={() => void run('refresh', refreshTokens)}
                />
                <ActionButton
                  icon={Siren}
                  label="Replay an old refresh token"
                  tone="danger"
                  busy={busy === 'replay'}
                  disabled={state.retiredRefreshTokens.length === 0}
                  hint={
                    state.retiredRefreshTokens.length === 0
                      ? 'Refresh once first, then replay the old token'
                      : 'Simulates a stolen token - watch the whole family get revoked'
                  }
                  onClick={() => void run('replay', replayOldRefreshToken)}
                />
                <ActionButton
                  icon={Ban}
                  label="Revoke access token"
                  busy={busy === 'revoke'}
                  onClick={() => void run('revoke', revokeAccessToken)}
                />
                <a
                  href={discovery ? logoutUrl(discovery, tokens.id_token) : '#'}
                  onClick={() => clearState()}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition hover:bg-surface-2"
                >
                  <LogOut className="size-4 text-subtle" /> Sign out (RP-initiated logout)
                  <ChevronRight className="ml-auto size-4 text-subtle" />
                </a>
              </CardBody>
            </Card>
            {lastReuse ? (
              <Alert tone="warning" title="Refresh token reuse detected">
                Gatekeeper revoked every token in this family. Try <b>Call userinfo</b> or <b>Refresh</b> - both now
                fail. Check the admin audit log for the <code className="font-mono">token.reuse_detected</code> event.
              </Alert>
            ) : null}
          </div>

          <div className="min-w-0 space-y-6">
            <Card>
              <div className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-2">
                {(
                  [
                    ['id', 'ID token', Boolean(tokens.id_token)],
                    ['access', 'Access token', true],
                    ['userinfo', 'Userinfo', true],
                    ['response', 'Token response', true],
                  ] as [Tab, string, boolean][]
                )
                  .filter(([, , show]) => show)
                  .map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      className={cn(
                        '-mb-px cursor-pointer border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition',
                        tab === key ? 'border-brand-500 text-fg' : 'border-transparent text-subtle hover:text-fg',
                      )}
                    >
                      {label}
                    </button>
                  ))}
              </div>
              <CardBody className="py-5">
                {tab === 'id' && tokens.id_token ? <JwtView token={tokens.id_token} /> : null}
                {tab === 'access' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted">
                      A JWT access token (<code className="font-mono">typ: at+jwt</code>, RFC 9068). Note{' '}
                      <code className="font-mono">resource_access</code> - per-client roles. Expires at{' '}
                      {access?.payload.exp ? new Date((access.payload.exp as number) * 1000).toLocaleTimeString() : '?'}
                      .
                    </p>
                    <JwtView token={tokens.access_token} />
                  </div>
                ) : null}
                {tab === 'userinfo' ? (
                  state.userinfo ? (
                    <JsonView value={state.userinfo} />
                  ) : (
                    <p className="text-sm text-muted">Not called yet.</p>
                  )
                ) : null}
                {tab === 'response' ? <JsonView value={tokens} /> : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Protocol trace" description="Every request this app made, in order." />
              <ol className="divide-y divide-border">
                {state.trace.map((t, i) => (
                  <TraceRow key={t.id} index={i + 1} entry={t} />
                ))}
              </ol>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  busy,
  disabled,
  hint,
  tone,
}: {
  icon: typeof User;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled ?? busy}
      className={cn(
        'flex w-full cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left text-sm transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'danger' && 'border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0 text-subtle',
          busy && 'animate-spin',
          tone === 'danger' && 'text-red-500',
        )}
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint ? <span className="block text-xs text-subtle">{hint}</span> : null}
      </span>
      <ArrowRight className="ml-auto size-4 shrink-0 text-subtle" />
    </button>
  );
}

function TraceRow({ entry, index }: { entry: PlaygroundState['trace'][number]; index: number }) {
  const [open, setOpen] = useState(false);
  const hasBody = Boolean(entry.request ?? entry.response);
  return (
    <li className="px-5 py-3">
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        disabled={!hasBody}
      >
        <span className="mt-0.5 font-mono text-xs text-subtle">{String(index).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{entry.title}</p>
            {entry.status ? (
              <Badge tone={entry.status < 300 ? 'success' : entry.status < 500 ? 'warning' : 'danger'}>
                {entry.status}
              </Badge>
            ) : null}
          </div>
          {entry.url ? (
            <p className="mt-0.5 font-mono text-xs text-subtle">
              <span className="font-semibold text-muted">{entry.method}</span> {entry.url}
            </p>
          ) : null}
          {entry.detail ? <p className="mt-1 text-xs text-muted">{entry.detail}</p> : null}
        </div>
        {hasBody ? (
          <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-subtle transition', open && 'rotate-90')} />
        ) : null}
      </button>
      {open ? (
        <div className="mt-3 grid gap-3 pl-7 md:grid-cols-2">
          {entry.request ? (
            <div>
              <p className="mb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">Request</p>
              <JsonView value={entry.request} className="p-3 text-[11.5px]" />
            </div>
          ) : null}
          {entry.response ? (
            <div>
              <p className="mb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">Response</p>
              <JsonView value={entry.response} className="p-3 text-[11.5px]" />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
