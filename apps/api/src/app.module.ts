import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AccountController } from './account/account.controller';
import { AdminController } from './admin/admin.controller';
import { ClientsService } from './admin/clients.service';
import { AuditModule } from './audit/audit.module';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CsrfMiddleware } from './common/csrf';
import { loggerOptions } from './common/logging';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { DemoController } from './demo/demo.controller';
import { DemoService } from './demo/demo.service';
import { HealthController } from './health/health.controller';
import { KeysModule } from './keys/keys.module';
import { MailModule } from './mail/mail.module';
import { MfaService } from './mfa/mfa.service';
import { OAuthModule } from './oauth/oauth.module';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { PasswordService } from './users/password.service';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerOptions(env) }),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        // The e2e suite performs many logins from one IP; it opts back in to test throttling explicitly.
        skipIf: () => env.NODE_ENV === 'test' && process.env.TEST_ENABLE_THROTTLE !== 'true',
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    MailModule,
    KeysModule,
    SessionsModule,
    OAuthModule,
  ],
  controllers: [AuthController, AccountController, AdminController, DemoController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AuthService,
    PasswordService,
    MfaService,
    ClientsService,
    DemoService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfMiddleware).forRoutes({ path: 'api/*path', method: RequestMethod.ALL });
  }
}
