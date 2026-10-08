import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + database connectivity' })
  async health(@Res({ passthrough: true }) res: Response) {
    const started = performance.now();
    let db: { status: 'up' | 'down'; latencyMs?: number } = { status: 'down' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch {
      res.status(503);
    }
    res.setHeader('Cache-Control', 'no-store');
    return {
      status: db.status === 'up' ? 'ok' : 'degraded',
      db,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '1.0.0',
    };
  }
}
