import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SignJWT, decodeProtectedHeader, jwtVerify, errors as joseErrors, type JWTPayload } from 'jose';
import { ENV, type Env } from '../config/env';
import { KeysService, SIGNING_ALG } from './keys.service';

export interface SignOptions {
  typ?: string;
  expiresInSeconds: number;
}

export class InvalidTokenError extends Error {}

@Injectable()
export class JwtService {
  constructor(
    private readonly keys: KeysService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get issuer(): string {
    return this.env.ISSUER_URL;
  }

  async sign(payload: JWTPayload, opts: SignOptions): Promise<string> {
    const key = await this.keys.getActiveKey();
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(payload)
      .setProtectedHeader({ alg: SIGNING_ALG, kid: key.kid, typ: opts.typ ?? 'JWT' })
      .setIssuer(this.env.ISSUER_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + opts.expiresInSeconds)
      .sign(key.privateKey);
  }

  /**
   * Verifies a token issued by this server. The algorithm is pinned to RS256
   * (no `alg: none` / HMAC confusion) and the key must be currently published.
   */
  async verify(
    token: string,
    opts: { typ?: string; audience?: string; allowExpired?: boolean } = {},
  ): Promise<JWTPayload> {
    let kid: string | undefined;
    try {
      kid = decodeProtectedHeader(token).kid;
    } catch {
      throw new InvalidTokenError('Malformed token');
    }
    if (!kid) throw new InvalidTokenError('Token has no kid');
    const key = await this.keys.verificationKey(kid);
    if (!key) throw new InvalidTokenError('Unknown signing key');
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: [SIGNING_ALG],
        issuer: this.env.ISSUER_URL,
        audience: opts.audience,
        typ: opts.typ,
        // A practically infinite tolerance is how jose lets us accept expired id_token_hints.
        clockTolerance: opts.allowExpired ? 60 * 60 * 24 * 365 : 5,
      });
      return payload;
    } catch (err) {
      if (err instanceof joseErrors.JOSEError) throw new InvalidTokenError(err.code);
      throw err;
    }
  }
}

/** OIDC `at_hash`: left-most half of SHA-256(access_token), base64url. */
export function accessTokenHash(accessToken: string): string {
  const digest = createHash('sha256').update(accessToken, 'ascii').digest();
  return digest.subarray(0, digest.length / 2).toString('base64url');
}
