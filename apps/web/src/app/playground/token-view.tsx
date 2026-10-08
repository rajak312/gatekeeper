'use client';

import { JsonView } from '@/components/json-view';
import { CopyButton } from '@/components/ui/copy-button';
import { CLAIM_DESCRIPTIONS, TIME_CLAIMS, decodeJwt } from '@/lib/jwt';

function ClaimValue({ name, value }: { name: string; value: unknown }) {
  if (TIME_CLAIMS.has(name) && typeof value === 'number') {
    return (
      <span>
        <span className="font-mono">{value}</span>{' '}
        <span className="text-subtle">· {new Date(value * 1000).toLocaleString()}</span>
      </span>
    );
  }
  return <span className="font-mono break-all">{typeof value === 'string' ? value : JSON.stringify(value)}</span>;
}

/** Shows a JWT as encoded segments + decoded header/payload + a claims table. */
export function JwtView({ token }: { token: string }) {
  const decoded = decodeJwt(token);
  if (!decoded) return <p className="text-sm text-muted">Not a JWT.</p>;
  const [h, p, s] = decoded.parts;
  return (
    <div className="space-y-5">
      <div className="relative rounded-lg border border-border bg-surface-2/60 p-4 pr-10 font-mono text-[12px] leading-relaxed break-all">
        <span className="text-rose-500 dark:text-rose-400">{h}</span>.
        <span className="text-violet-600 dark:text-violet-400">{p}</span>.
        <span className="text-sky-600 dark:text-sky-400">{s}</span>
        <CopyButton value={token} className="absolute top-2 right-2" label="Copy token" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <p className="mb-1.5 text-xs font-medium tracking-wide text-rose-500 uppercase dark:text-rose-400">Header</p>
          <JsonView value={decoded.header} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium tracking-wide text-violet-600 uppercase dark:text-violet-400">
            Payload
          </p>
          <JsonView value={decoded.payload} />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2/60 text-xs text-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Claim</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Meaning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.entries(decoded.payload).map(([k, v]) => (
              <tr key={k} className="align-top">
                <td className="px-3 py-2 font-mono text-xs font-medium text-fg">{k}</td>
                <td className="max-w-[22rem] px-3 py-2 text-xs text-muted">
                  <ClaimValue name={k} value={v} />
                </td>
                <td className="hidden px-3 py-2 text-xs text-subtle md:table-cell">{CLAIM_DESCRIPTIONS[k] ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
