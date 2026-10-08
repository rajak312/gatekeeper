import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ConsoleTransport, MAIL_TRANSPORT, MailService, OutboxTransport } from './mailer';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService) =>
        env.MAIL_DRIVER === 'console' ? new ConsoleTransport() : new OutboxTransport(prisma),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
