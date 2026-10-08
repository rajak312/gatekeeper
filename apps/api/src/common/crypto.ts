import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token with `bytes` bytes of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 hex digest. Used for high-entropy secrets (session tokens, refresh
 * tokens, authorization codes, client secrets): these are random 256-bit values,
 * so a fast hash is sufficient - there is nothing to brute force.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison that does not leak length via early exit. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

const ENC_VERSION = 'v1';

/**
 * Authenticated encryption (AES-256-GCM) for data at rest such as private
 * signing keys and TOTP secrets. The key is derived from KEY_ENCRYPTION_SECRET
 * with HKDF, and an optional `context` is bound as additional authenticated data
 * so a ciphertext cannot be swapped between records.
 */
export class Encryptor {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'gatekeeper', 'gatekeeper:data-encryption:v1', 32));
  }

  encrypt(plaintext: string, context = ''): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENC_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
      '.',
    );
  }

  decrypt(payload: string, context = ''): string {
    const [version, iv, tag, ciphertext] = payload.split('.');
    if (version !== ENC_VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported ciphertext format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }
}
