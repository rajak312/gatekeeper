import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { KeysService } from '../keys/keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEMO_ADMIN, seedDatabase } from './seed';

/**
 * Seeds the database on first boot (SEED_ON_BOOT) and, in DEMO_MODE, resets
 * the shared demo on a schedule. Also purges expired protocol artifacts.
 */
@Injectable()
export class DemoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: KeysService,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return;
    if (this.env.SEED_ON_BOOT) {
      const seeded = await this.prisma.user.findUnique({ where: { email: DEMO_ADMIN.email } });
      if (!seeded) {
        await seedDatabase(this.prisma, {
          webUrl: this.env.WEB_URL,
          syntheticHistory: this.env.DEMO_MODE,
          log: (m) => this.logger.log(m),
        });
      }
    }
    await this.keys.getActiveKey();

    const cleanup = new CronJob('17 * * * *', () => void this.cleanup());
    this.scheduler.addCronJob('cleanup', cleanup);
    cleanup.start();

    if (this.env.DEMO_MODE) {
      const reset = new CronJob(this.env.DEMO_RESET_CRON, () => void this.reset('schedule'));
      this.scheduler.addCronJob('demo-reset', reset);
      reset.start();
      this.logger.log(`Demo mode: data resets on "${this.env.DEMO_RESET_CRON}"`);
    }
  }

  async reset(trigger: string, actor?: { id: string; email: string }): Promise<void> {
    await seedDatabase(this.prisma, { webUrl: this.env.WEB_URL, reset: true, log: (m) => this.logger.log(m) });
    await this.audit.record({
      type: 'demo.reset',
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      metadata: { trigger },
    });
  }

  /** Deletes expired interactions, codes, sessions and tokens. */
  async cleanup(): Promise<void> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    try {
      const [interactions, codes, sessions, access, refresh] = await this.prisma.$transaction([
        this.prisma.interaction.deleteMany({ where: { expiresAt: { lt: now } } }),
        this.prisma.authorizationCode.deleteMany({ where: { expiresAt: { lt: weekAgo } } }),
        this.prisma.session.deleteMany({
          where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] },
        }),
        this.prisma.accessToken.deleteMany({ where: { expiresAt: { lt: weekAgo } } }),
        this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: weekAgo } } }),
      ]);
      const keys = await this.keys.purgeExpired();
      this.logger.log(
        {
          interactions: interactions.count,
          codes: codes.count,
          sessions: sessions.count,
          access: access.count,
          refresh: refresh.count,
          keys,
        },
        'Cleanup finished',
      );
    } catch (err) {
      this.logger.error({ err }, 'Cleanup failed');
    }
  }
}
