import { Inject, Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, createPublicKey, generateKeyPair, type KeyObject } from 'node:crypto';
import { promisify } from 'node:util';
import { ENV, type Env } from '../config/env';
import { Encryptor, randomToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, SigningKey } from '../generated/prisma/client';

const generateKeyPairAsync = promisify(generateKeyPair);

export const SIGNING_ALG = 'RS256';
const CACHE_TTL_MS = 60_000;

export interface PublicJwk {
  kty: string;
  kid: string;
  use: 'sig';
  alg: string;
  n?: string;
  e?: string;
}

interface ActiveKey {
  kid: string;
  privateKey: KeyObject;
  loadedAt: number;
}

/**
 * Manages RSA signing keys. Private keys are encrypted at rest (AES-256-GCM,
 * bound to the key's kid). Rotation retires the active key but keeps it in the
 * JWKS for RETIRED_KEY_TTL so already-issued tokens remain verifiable.
 */
@Injectable()
export class KeysService {
  private readonly logger = new Logger(KeysService.name);
  private readonly encryptor: Encryptor;
  private active: ActiveKey | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.encryptor = new Encryptor(env.KEY_ENCRYPTION_SECRET);
  }

  /** Generates a new RSA-2048 key pair and returns the DB row data (private key encrypted). */
  async generateKeyMaterial(): Promise<Prisma.SigningKeyCreateInput> {
    const { publicKey, privateKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const kid = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomToken(6)}`;
    const jwk = publicKey.export({ format: 'jwk' });
    const publicJwk: PublicJwk = { kty: 'RSA', n: jwk.n, e: jwk.e, kid, use: 'sig', alg: SIGNING_ALG };
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    return {
      kid,
      alg: SIGNING_ALG,
      publicJwk: publicJwk as unknown as Prisma.InputJsonValue,
      privateKeyEnc: this.encryptor.encrypt(pem, `signing-key:${kid}`),
      status: 'ACTIVE',
    };
  }

  /** Returns the current signing key, creating the first one on demand. */
  async getActiveKey(): Promise<ActiveKey> {
    if (this.active && Date.now() - this.active.loadedAt < CACHE_TTL_MS) return this.active;

    let row = await this.prisma.signingKey.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
    if (!row) row = await this.bootstrap();

    this.active = { kid: row.kid, privateKey: this.decryptPrivateKey(row), loadedAt: Date.now() };
    return this.active;
  }

  private async bootstrap(): Promise<SigningKey> {
    const material = await this.generateKeyMaterial();
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent bootstraps across instances.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(727274)`;
      const existing = await tx.signingKey.findFirst({ where: { status: 'ACTIVE' } });
      if (existing) return existing;
      this.logger.log(`Created initial signing key ${material.kid}`);
      return tx.signingKey.create({ data: material });
    });
  }

  private decryptPrivateKey(row: SigningKey): KeyObject {
    let pem: string;
    try {
      pem = this.encryptor.decrypt(row.privateKeyEnc, `signing-key:${row.kid}`);
    } catch {
      // GCM authentication failed: wrong secret or tampered row. Never fall back silently.
      throw new Error(
        `Cannot decrypt signing key "${row.kid}". KEY_ENCRYPTION_SECRET differs from the secret that encrypted it ` +
          '(or the row was tampered with). Restore the original secret or rotate keys against a fresh database.',
      );
    }
    return createPrivateKey(pem);
  }

  /** Retires the active key (still published until `publishUntil`) and activates a fresh one. */
  async rotate(): Promise<{ newKid: string; retiredKid: string | null }> {
    const material = await this.generateKeyMaterial();
    const now = new Date();
    const publishUntil = new Date(now.getTime() + this.env.RETIRED_KEY_TTL * 1000);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(727274)`;
      const current = await tx.signingKey.findMany({ where: { status: 'ACTIVE' } });
      await tx.signingKey.updateMany({
        where: { status: 'ACTIVE' },
        data: { status: 'RETIRED', retiredAt: now, publishUntil },
      });
      const created = await tx.signingKey.create({ data: material });
      return { newKid: created.kid, retiredKid: current[0]?.kid ?? null };
    });
    this.active = null;
    return result;
  }

  /** Keys that verifiers should trust: the active key plus recently retired ones. */
  async publishedKeys(now = new Date()): Promise<SigningKey[]> {
    return this.prisma.signingKey.findMany({
      where: { OR: [{ status: 'ACTIVE' }, { status: 'RETIRED', publishUntil: { gt: now } }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  async jwks(): Promise<{ keys: PublicJwk[] }> {
    await this.getActiveKey();
    const keys = await this.publishedKeys();
    return { keys: keys.map((k) => k.publicJwk as unknown as PublicJwk) };
  }

  /** Public key for `kid` if (and only if) it is currently published. */
  async verificationKey(kid: string): Promise<KeyObject | null> {
    const keys = await this.publishedKeys();
    const match = keys.find((k) => k.kid === kid);
    if (!match) return null;
    return createPublicKey({ key: match.publicJwk as never, format: 'jwk' });
  }

  async list(): Promise<SigningKey[]> {
    return this.prisma.signingKey.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Deletes retired keys that are no longer published. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.signingKey.deleteMany({
      where: { status: 'RETIRED', publishUntil: { lt: new Date() } },
    });
    return count;
  }
}
