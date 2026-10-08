import { describe, expect, it } from 'vitest';
import { jwtVerify, createLocalJWKSet } from 'jose';
import type { Env } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import { FakePrisma } from '../testing/fake-prisma';
import { JwtService } from './jwt.service';
import { KeysService } from './keys.service';

const env = {
  ISSUER_URL: 'https://idp.example.com',
  KEY_ENCRYPTION_SECRET: 'unit-test-secret-unit-test-secret-1234',
  RETIRED_KEY_TTL: 3600,
} as Env;

function setup() {
  const prisma = new FakePrisma();
  const keys = new KeysService(prisma as unknown as PrismaService, env);
  const jwt = new JwtService(keys, env);
  return { prisma, keys, jwt };
}

describe('KeysService', () => {
  it('bootstraps a single active RS256 key on first use', async () => {
    const { prisma, keys } = setup();
    const active = await keys.getActiveKey();
    expect(prisma.table('signingKey')).toHaveLength(1);
    const jwks = await keys.jwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kid: active.kid, kty: 'RSA', alg: 'RS256', use: 'sig' });
  });

  it('stores the private key encrypted, never as PEM', async () => {
    const { prisma, keys } = setup();
    await keys.getActiveKey();
    const row = prisma.table('signingKey')[0]!;
    expect(row.privateKeyEnc).toMatch(/^v1\./);
    expect(String(row.privateKeyEnc)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(row.publicJwk)).not.toMatch(/"d"/);
  });

  it('rotation retires the old key but keeps it published until expiry', async () => {
    const { prisma, keys } = setup();
    const before = await keys.getActiveKey();
    const { newKid, retiredKid } = await keys.rotate();
    expect(retiredKid).toBe(before.kid);
    expect(newKid).not.toBe(before.kid);

    const after = await keys.getActiveKey();
    expect(after.kid).toBe(newKid);

    const jwks = await keys.jwks();
    expect(jwks.keys.map((k) => k.kid).sort()).toEqual([before.kid, newKid].sort());

    // Once the retention window passes, the retired key disappears from the JWKS.
    const retired = prisma.table('signingKey').find((k) => k.kid === before.kid)!;
    retired.publishUntil = new Date(Date.now() - 1000);
    expect((await keys.jwks()).keys.map((k) => k.kid)).toEqual([newKid]);
    expect(await keys.purgeExpired()).toBe(1);
  });

  it('tokens signed before a rotation still verify against the published JWKS', async () => {
    const { keys, jwt } = setup();
    const oldToken = await jwt.sign({ sub: 'user-1' }, { expiresInSeconds: 300 });
    await keys.rotate();
    const newToken = await jwt.sign({ sub: 'user-1' }, { expiresInSeconds: 300 });

    const jwks = createLocalJWKSet(await keys.jwks());
    await expect(jwtVerify(oldToken, jwks, { issuer: env.ISSUER_URL })).resolves.toBeTruthy();
    await expect(jwtVerify(newToken, jwks, { issuer: env.ISSUER_URL })).resolves.toBeTruthy();
    await expect(jwt.verify(oldToken)).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('refuses tokens signed with a key that is no longer published', async () => {
    const { prisma, keys, jwt } = setup();
    const token = await jwt.sign({ sub: 'user-1' }, { expiresInSeconds: 300 });
    await keys.rotate();
    for (const k of prisma.table('signingKey')) if (k.status === 'RETIRED') k.publishUntil = new Date(0);
    await expect(jwt.verify(token)).rejects.toThrow('Unknown signing key');
  });

  it('rejects a token whose signature was tampered with or uses alg=none', async () => {
    const { jwt } = setup();
    const token = await jwt.sign({ sub: 'user-1', role: 'user' }, { expiresInSeconds: 300 });
    const [h, p, s] = token.split('.') as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), role: 'admin' }),
    ).toString('base64url');
    await expect(jwt.verify(`${h}.${forgedPayload}.${s}`)).rejects.toThrow();

    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const noneHeader = Buffer.from(JSON.stringify({ ...header, alg: 'none' })).toString('base64url');
    await expect(jwt.verify(`${noneHeader}.${p}.`)).rejects.toThrow();
  });
});
