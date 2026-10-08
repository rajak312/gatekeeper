import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { consentDecisionSchema, type ConsentDecisionInput, type InteractionDetails } from '@gatekeeper/shared';
import type { Request } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { requestMeta } from '../common/request';
import { Auth, SessionGuard } from '../sessions/auth.guard';
import { SessionsService, type SessionWithUser } from '../sessions/sessions.service';
import { AuthorizeService } from './authorize.service';

@ApiTags('Interactions (hosted login UI)')
@Controller('api/interactions')
export class InteractionsController {
  constructor(
    private readonly authorize: AuthorizeService,
    private readonly sessions: SessionsService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Describe a pending authorization request (client, scopes) for the login/consent UI' })
  async details(@Param('id') id: string, @Req() req: Request): Promise<InteractionDetails> {
    return this.authorize.details(id, await this.sessions.resolve(req));
  }

  @Post(':id/consent')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Approve or deny a consent request; returns where to redirect the browser' })
  async consent(
    @Param('id') id: string,
    @Body(new ZodPipe(consentDecisionSchema)) body: ConsentDecisionInput,
    @Auth() session: SessionWithUser,
    @Req() req: Request,
  ): Promise<{ redirectTo: string }> {
    return { redirectTo: await this.authorize.decide(id, session, body, requestMeta(req)) };
  }
}
