import { Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENV, type Env } from '../config/env';
import { ApiError } from '../common/errors';
import { AdminGuard, Auth } from '../sessions/auth.guard';
import type { SessionWithUser } from '../sessions/sessions.service';
import { DemoService } from './demo.service';

@ApiTags('Admin')
@ApiCookieAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/demo')
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset the shared demo data (DEMO_MODE only)' })
  async reset(@Auth() s: SessionWithUser) {
    if (!this.env.DEMO_MODE) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found', 'Demo mode is disabled');
    await this.demo.reset('manual', { id: s.userId, email: s.user.email });
    return { ok: true };
  }
}
