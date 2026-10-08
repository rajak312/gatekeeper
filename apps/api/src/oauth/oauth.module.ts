import { Module } from '@nestjs/common';
import { AuthorizeService } from './authorize.service';
import { ClientAuthService } from './client-auth.service';
import { InteractionsController } from './interactions.controller';
import { LogoutService } from './logout.service';
import { OAuthController } from './oauth.controller';
import { ScopeRegistry } from './scope-registry.service';
import { TokenService } from './token.service';

@Module({
  controllers: [OAuthController, InteractionsController],
  providers: [AuthorizeService, ClientAuthService, LogoutService, ScopeRegistry, TokenService],
  exports: [AuthorizeService, LogoutService, ScopeRegistry, TokenService],
})
export class OAuthModule {}
