import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import type { MfaSetupResponse } from '@gatekeeper/shared';
import { ENV, type Env } from '../config/env';
import { Encryptor, safeEqual, sha256 } from '../common/crypto';
import { ApiError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '../generated/prisma/client';
import { generateRecoveryCodes, generateTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from './totp';

const ISSUER_LABEL = 'Gatekeeper';

@Injectable()
export class MfaService {
  private readonly encryptor: Encryptor;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.encryptor = new Encryptor(env.KEY_ENCRYPTION_SECRET);
  }

  private secretOf(user: User): string | null {
    return user.totpSecretEnc ? this.encryptor.decrypt(user.totpSecretEnc, `totp:${user.id}`) : null;
  }

  /** Starts enrollment: stores a new (encrypted) secret that is inactive until verified. */
  async beginEnrollment(user: User): Promise<MfaSetupResponse> {
    if (user.totpEnabledAt) throw new ApiError(HttpStatus.CONFLICT, 'mfa_already_enabled', 'MFA is already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: this.encryptor.encrypt(secret, `totp:${user.id}`), totpLastStep: null },
    });
    const url = otpauthUrl(secret, user.email, ISSUER_LABEL);
    const qrCodeDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
    return { secret, otpauthUrl: url, qrCodeDataUrl };
  }

  /** Confirms enrollment with a first valid code and returns fresh recovery codes (shown once). */
  async activate(user: User, code: string): Promise<string[]> {
    if (user.totpEnabledAt) throw new ApiError(HttpStatus.CONFLICT, 'mfa_already_enabled', 'MFA is already enabled');
    const secret = this.secretOf(user);
    if (!secret) throw new ApiError(HttpStatus.BAD_REQUEST, 'mfa_not_started', 'Start MFA enrollment first');
    const step = verifyTotp(secret, code);
    if (step === null)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'invalid_code',
        'That code is not valid. Check the time on your device and try again.',
      );
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), totpLastStep: step } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.recoveryCode.createMany({
        data: codes.map((c) => ({ userId: user.id, codeHash: sha256(normalizeRecoveryCode(c)) })),
      }),
    ]);
    return codes;
  }

  /**
   * Verifies a TOTP code for an MFA-enabled user, rejecting replays of a code
   * (time step) that was already used. The step is advanced with a conditional
   * update so two concurrent requests can't both succeed with the same code.
   */
  async verifyCode(user: User, code: string): Promise<boolean> {
    const secret = this.secretOf(user);
    if (!secret || !user.totpEnabledAt) return false;
    const step = verifyTotp(secret, code, { lastUsedStep: user.totpLastStep });
    if (step === null) return false;
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return count === 1;
  }

  /** Consumes a single-use recovery code. */
  async useRecoveryCode(user: User, code: string): Promise<boolean> {
    const hash = sha256(normalizeRecoveryCode(code));
    const candidates = await this.prisma.recoveryCode.findMany({ where: { userId: user.id, usedAt: null } });
    const match = candidates.find((c) => safeEqual(c.codeHash, hash));
    if (!match) return false;
    const { count } = await this.prisma.recoveryCode.updateMany({
      where: { id: match.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  async remainingRecoveryCodes(userId: string): Promise<number> {
    return this.prisma.recoveryCode.count({ where: { userId, usedAt: null } });
  }

  async regenerateRecoveryCodes(user: User): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.recoveryCode.createMany({
        data: codes.map((c) => ({ userId: user.id, codeHash: sha256(normalizeRecoveryCode(c)) })),
      }),
    ]);
    return codes;
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null },
      }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ]);
  }
}
