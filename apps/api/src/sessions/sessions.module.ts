import { Global, Module } from '@nestjs/common';
import { AdminGuard, SessionGuard } from './auth.guard';
import { SessionsService } from './sessions.service';

@Global()
@Module({
  providers: [SessionsService, SessionGuard, AdminGuard],
  exports: [SessionsService, SessionGuard, AdminGuard],
})
export class SessionsModule {}
