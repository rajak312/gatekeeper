import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { sha256 } from '../common/crypto';
import { OAuthError } from '../common/errors';
import type { PrismaService } from '../prisma/prisma.service';
import { FakePrisma } from '../testing/fake-prisma';
import { ClientAuthService } from './client-auth.service';

const SECRET = 'gks_super-secret value';

async function setup() {
  const prisma = new FakePrisma();
  await prisma
    .model('client')
    .create({ data: { clientId: 'conf', type: 'CONFIDENTIAL', secretHash: sha256(SECRET), disabledAt: null } });
  await prisma
    .model('client')
    .create({ data: { clientId: 'pub', type: 'PUBLIC', secretHash: null, disabledAt: null } });
  await prisma
    .model('client')
    .create({ data: { clientId: 'off', type: 'PUBLIC', secretHash: null, disabledAt: new Date() } });
  return new ClientAuthService(prisma as unknown as PrismaService);
}

const req = (body: Record<string, string>, authorization?: string) =>
  ({ body, headers: authorization ? { authorization } : {} }) as unknown as Request;

const basic = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;

async function rejects(p: Promise<unknown>, error: string, status?: number) {
  const err = (await p.catch((e: unknown) => e)) as OAuthError;
  expect(err).toBeInstanceOf(OAuthError);
  expect(err.error).toBe(error);
  if (status) expect(err.status).toBe(status);
  return err;
}

describe('ClientAuthService', () => {
  it('authenticates confidential clients with client_secret_basic (form-urlencoded credentials)', async () => {
    const svc = await setup();
    const res = await svc.authenticate(req({}, basic('conf', SECRET)));
    expect(res).toMatchObject({ method: 'client_secret_basic', client: { clientId: 'conf' } });
  });

  it('authenticates confidential clients with client_secret_post', async () => {
    const svc = await setup();
    const res = await svc.authenticate(req({ client_id: 'conf', client_secret: SECRET }));
    expect(res.method).toBe('client_secret_post');
  });

  it('rejects a wrong secret with 401 and a WWW-Authenticate challenge for Basic', async () => {
    const svc = await setup();
    const err = await rejects(svc.authenticate(req({}, basic('conf', 'wrong'))), 'invalid_client', 401);
    expect(err.headers['WWW-Authenticate']).toMatch(/^Basic/);
  });

  it('rejects confidential clients that omit the secret', async () => {
    const svc = await setup();
    await rejects(svc.authenticate(req({ client_id: 'conf' })), 'invalid_client', 401);
  });

  it('identifies public clients by client_id only', async () => {
    const svc = await setup();
    expect((await svc.authenticate(req({ client_id: 'pub' }))).method).toBe('none');
  });

  it('refuses a secret sent by a public client', async () => {
    const svc = await setup();
    await rejects(svc.authenticate(req({ client_id: 'pub', client_secret: 'x' })), 'invalid_client');
  });

  it('refuses multiple authentication methods at once', async () => {
    const svc = await setup();
    await rejects(svc.authenticate(req({ client_secret: SECRET }, basic('conf', SECRET))), 'invalid_request');
  });

  it('rejects unknown and disabled clients identically', async () => {
    const svc = await setup();
    const a = await rejects(svc.authenticate(req({ client_id: 'nope' })), 'invalid_client');
    const b = await rejects(svc.authenticate(req({ client_id: 'off' })), 'invalid_client');
    expect(a.description).toBe(b.description);
  });

  it('requires some form of client identification', async () => {
    const svc = await setup();
    await rejects(svc.authenticate(req({})), 'invalid_client');
  });
});
