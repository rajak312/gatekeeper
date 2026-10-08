import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** OWASP Password Storage Cheat Sheet baseline for argon2id (19 MiB, t=2, p=1). */
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

@Injectable()
export class PasswordService {
  /** Pre-computed hash used to equalize timing when the account doesn't exist. */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    // @node-rs/argon2 defaults to argon2id.
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Burns the same CPU as a real verification so response times don't reveal whether an email exists. */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('gatekeeper-timing-equalizer');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
