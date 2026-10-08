'use client';

import { GRANT_TYPES, type ClientSummary, type ScopeInfo } from '@gatekeeper/shared';
import useSWR from 'swr';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';

export interface ClientFormValue {
  name: string;
  description: string;
  type: 'PUBLIC' | 'CONFIDENTIAL';
  redirectUris: string;
  postLogoutRedirectUris: string;
  allowedScopes: string[];
  grantTypes: string[];
  requireConsent: boolean;
  accessTokenTtl: number;
  refreshTokenTtl: number;
}

export function initialValue(c?: ClientSummary): ClientFormValue {
  return {
    name: c?.name ?? '',
    description: c?.description ?? '',
    type: c?.type ?? 'PUBLIC',
    redirectUris: (c?.redirectUris ?? []).join('\n'),
    postLogoutRedirectUris: (c?.postLogoutRedirectUris ?? []).join('\n'),
    allowedScopes: c?.allowedScopes ?? ['openid', 'profile', 'email'],
    grantTypes: c?.grantTypes ?? ['authorization_code', 'refresh_token'],
    requireConsent: c?.requireConsent ?? true,
    accessTokenTtl: c?.accessTokenTtl ?? 900,
    refreshTokenTtl: c?.refreshTokenTtl ?? 2592000,
  };
}

export function toPayload(v: ClientFormValue) {
  const lines = (s: string) =>
    s
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    name: v.name,
    description: v.description || undefined,
    type: v.type,
    redirectUris: lines(v.redirectUris),
    postLogoutRedirectUris: lines(v.postLogoutRedirectUris),
    allowedScopes: v.allowedScopes,
    grantTypes: v.grantTypes,
    requireConsent: v.requireConsent,
    accessTokenTtl: Number(v.accessTokenTtl),
    refreshTokenTtl: Number(v.refreshTokenTtl),
  };
}

const GRANT_HELP: Record<string, string> = {
  authorization_code: 'Users sign in through Gatekeeper (with PKCE)',
  refresh_token: 'Long-lived sessions via rotating refresh tokens',
  client_credentials: 'Machine-to-machine, no user (confidential only)',
};

export function ClientForm({
  value,
  onChange,
  editing,
  locked,
}: {
  value: ClientFormValue;
  onChange: (v: ClientFormValue) => void;
  editing?: boolean;
  locked?: boolean;
}) {
  const { data: scopes } = useSWR<ScopeInfo[]>('/api/admin/scopes');
  const set = <K extends keyof ClientFormValue>(k: K, v: ClientFormValue[K]) => onChange({ ...value, [k]: v });
  const toggle = (k: 'allowedScopes' | 'grantTypes', item: string, on: boolean) =>
    set(k, on ? [...new Set([...value[k], item])] : value[k].filter((x) => x !== item));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="c-name">
          <Input
            id="c-name"
            autoFocus
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Acme Dashboard"
          />
        </Field>
        <Field label="Description" htmlFor="c-desc">
          <Input
            id="c-desc"
            value={value.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Shown on the consent screen"
          />
        </Field>
      </div>

      {!editing ? (
        <div>
          <p className="mb-2 text-sm font-medium">Client type</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['PUBLIC', 'Public', 'SPAs and mobile apps. Cannot keep a secret - protected by PKCE.'],
                ['CONFIDENTIAL', 'Confidential', 'Server-side apps and services. Authenticates with a client secret.'],
              ] as const
            ).map(([type, title, body]) => (
              <button
                key={type}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    type,
                    grantTypes:
                      type === 'PUBLIC' ? value.grantTypes.filter((g) => g !== 'client_credentials') : value.grantTypes,
                  })
                }
                className={cn(
                  'cursor-pointer rounded-lg border p-3 text-left transition',
                  value.type === type
                    ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500 dark:bg-brand-950/30'
                    : 'border-border hover:border-border-strong',
                )}
              >
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-muted">{body}</p>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-sm font-medium">Grant types</p>
        <div className="space-y-2.5">
          {GRANT_TYPES.map((g) => (
            <Checkbox
              key={g}
              id={`g-${g}`}
              checked={value.grantTypes.includes(g)}
              disabled={locked || (g === 'client_credentials' && value.type === 'PUBLIC')}
              onChange={(on) => toggle('grantTypes', g, on)}
              label={<span className="font-mono text-[13px]">{g}</span>}
              description={GRANT_HELP[g]}
            />
          ))}
        </div>
      </div>

      <Field
        label="Redirect URIs"
        htmlFor="c-redirects"
        hint="One per line. Exact match; https required except for localhost."
      >
        <Textarea
          id="c-redirects"
          rows={3}
          disabled={locked}
          className="font-mono text-xs"
          value={value.redirectUris}
          onChange={(e) => set('redirectUris', e.target.value)}
          placeholder="https://app.example.com/callback"
        />
      </Field>
      <Field label="Post-logout redirect URIs" htmlFor="c-logout" hint="Allowed targets for RP-initiated logout.">
        <Textarea
          id="c-logout"
          rows={2}
          disabled={locked}
          className="font-mono text-xs"
          value={value.postLogoutRedirectUris}
          onChange={(e) => set('postLogoutRedirectUris', e.target.value)}
        />
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium">Allowed scopes</p>
        <div className="flex flex-wrap gap-2">
          {(scopes ?? []).map((s) => {
            const on = value.allowedScopes.includes(s.name);
            return (
              <button
                key={s.id}
                type="button"
                disabled={locked}
                title={s.description}
                onClick={() => toggle('allowedScopes', s.name, !on)}
                className={cn(
                  'cursor-pointer rounded-md border px-2 py-1 font-mono text-xs transition disabled:cursor-not-allowed disabled:opacity-60',
                  on
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                    : 'border-border text-muted hover:border-border-strong',
                )}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Access token lifetime (seconds)" htmlFor="c-at" hint="60 - 3600">
          <Input
            id="c-at"
            type="number"
            min={60}
            max={3600}
            value={value.accessTokenTtl}
            onChange={(e) => set('accessTokenTtl', Number(e.target.value))}
          />
        </Field>
        <Field label="Refresh token lifetime (seconds)" htmlFor="c-rt" hint="Absolute lifetime of each rotated token">
          <Input
            id="c-rt"
            type="number"
            min={300}
            value={value.refreshTokenTtl}
            onChange={(e) => set('refreshTokenTtl', Number(e.target.value))}
          />
        </Field>
      </div>

      <Checkbox
        id="c-consent"
        checked={value.requireConsent}
        onChange={(v) => set('requireConsent', v)}
        label="Require user consent"
        description="Turn off only for first-party apps you fully trust."
      />
    </div>
  );
}
