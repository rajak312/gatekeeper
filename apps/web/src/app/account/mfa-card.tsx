'use client';

import type { CurrentUser, MfaSetupResponse } from '@gatekeeper/shared';
import { Download, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div className="space-y-3">
      <Alert tone="warning" title="Save these recovery codes now">
        Each code works once if you lose your device. They won&apos;t be shown again - Gatekeeper only stores hashes.
      </Alert>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-2/60 p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.download = 'gatekeeper-recovery-codes.txt';
            a.click();
          }}
        >
          <Download className="size-3.5" /> Download
        </Button>
        <span className="inline-flex items-center gap-1 text-xs text-subtle">
          <CopyButton value={text} /> Copy all
        </span>
      </div>
    </div>
  );
}

export function MfaCard({ me, onChange }: { me: CurrentUser; onChange: () => void }) {
  const toast = useToast();
  const { data: status, mutate } = useSWR<MfaStatus>('/api/account/mfa');
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api<MfaSetupResponse>('/api/account/mfa/setup', { method: 'POST' }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ recoveryCodes: string[] }>('/api/account/mfa/activate', {
        method: 'POST',
        body: { code },
      });
      setCodes(res.recoveryCodes);
      setCode('');
      void mutate();
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/account/mfa/disable', { method: 'POST', body: { password, code } });
      setDisableOpen(false);
      setPassword('');
      setCode('');
      toast.success('Two-factor authentication disabled');
      void mutate();
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const enabled = status?.enabled ?? me.mfaEnabled;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Two-factor authentication{' '}
            {enabled ? (
              <Badge tone="success" dot>
                On
              </Badge>
            ) : (
              <Badge tone="warning" dot>
                Off
              </Badge>
            )}
          </span>
        }
        description="Require a code from an authenticator app (TOTP, RFC 6238) when signing in."
      />
      <CardBody>
        {me.isProtected ? (
          <Alert tone="info">
            MFA can&apos;t be enabled on the shared demo accounts. Create your own account to try enrollment.
          </Alert>
        ) : enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <ShieldCheck className="size-5 text-emerald-500" />
              <span>
                Authenticator app configured ·{' '}
                <span className="text-muted">{status?.recoveryCodesRemaining ?? '-'} recovery codes left</span>
              </span>
            </div>
            <Button variant="danger-outline" size="sm" onClick={() => setDisableOpen(true)}>
              <ShieldOff className="size-3.5" /> Disable
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Protect your account even if your password leaks.</p>
            <Button onClick={() => void begin()} loading={busy && !setup}>
              <Smartphone className="size-4" /> Set up authenticator
            </Button>
          </div>
        )}
      </CardBody>

      <Dialog
        open={Boolean(setup)}
        onClose={() => {
          setSetup(null);
          setCodes(null);
          setError(null);
        }}
        title={codes ? 'Two-factor authentication is on' : 'Set up your authenticator app'}
        description={codes ? undefined : 'Scan the QR code with Google Authenticator, 1Password, Authy or similar.'}
        footer={
          codes ? (
            <Button onClick={() => setSetup(null)}>Done</Button>
          ) : (
            <Button onClick={() => void activate()} loading={busy} disabled={!/^\d{6}$/.test(code)}>
              Verify &amp; enable
            </Button>
          )
        }
      >
        {codes ? (
          <RecoveryCodes codes={codes} />
        ) : setup ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL generated by the API */}
              <img
                src={setup.qrCodeDataUrl}
                alt="TOTP QR code"
                width={168}
                height={168}
                className="rounded-lg border border-border bg-white p-1.5"
              />
              <div className="min-w-0 space-y-2 text-sm">
                <p className="text-muted">Can&apos;t scan? Enter this key manually:</p>
                <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2/60 px-2.5 py-1.5">
                  <code className="min-w-0 flex-1 font-mono text-xs break-all">
                    {setup.secret.match(/.{1,4}/g)?.join(' ')}
                  </code>
                  <CopyButton value={setup.secret} />
                </div>
                <p className="text-xs text-subtle">SHA-1 · 6 digits · 30 seconds</p>
              </div>
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label="Enter the 6-digit code" htmlFor="totp-code">
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="font-mono tracking-[0.3em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Disable two-factor authentication?"
        description="Confirm with your password and a current code."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void disable()} loading={busy}>
              Disable MFA
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Password" htmlFor="mfa-pw">
            <Input
              id="mfa-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Authenticator code" htmlFor="mfa-code">
            <Input
              id="mfa-code"
              inputMode="numeric"
              maxLength={6}
              className="font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}
