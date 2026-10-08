import { Injectable, Logger } from '@nestjs/common';
import type { AuditEventType } from '@gatekeeper/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestMeta } from '../common/request';
import type { Prisma } from '../generated/prisma/client';

export interface AuditInput {
  type: AuditEventType;
  success?: boolean;
  actorId?: string | null;
  actorEmail?: string | null;
  subjectId?: string | null;
  clientId?: string | null;
  meta?: RequestMeta;
  metadata?: Record<string, unknown>;
}

/** Append-only audit trail of security events. Never store secrets in `metadata`. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          type: input.type,
          success: input.success ?? true,
          actorId: input.actorId ?? null,
          actorEmail: input.actorEmail ?? null,
          subjectId: input.subjectId ?? null,
          clientId: input.clientId ?? null,
          ip: input.meta?.ip ?? null,
          userAgent: input.meta?.userAgent ?? null,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      // Auditing must never break the request that triggered it.
      this.logger.error({ err, type: input.type }, 'Failed to write audit event');
    }
  }
}
