import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  assignClientRoleSchema,
  auditQuerySchema,
  createClientRoleSchema,
  createClientSchema,
  createScopeSchema,
  lockUserSchema,
  updateClientSchema,
  updateUserRolesSchema,
  userListQuerySchema,
  type AdminUserDetail,
  type AdminUserSummary,
  type AuditEventInfo,
  type AuditQuery,
  type ClientSummary,
  type ClientWithSecret,
  type CreateClientInput,
  type CursorPage,
  type DashboardStats,
  type OutboxEmailInfo,
  type Paginated,
  type ScopeInfo,
  type SigningKeyInfo,
  type UpdateClientInput,
} from '@gatekeeper/shared';
import { ENV, type Env } from '../config/env';
import { ApiError } from '../common/errors';
import { requestMeta } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { KeysService } from '../keys/keys.service';
import { MfaService } from '../mfa/mfa.service';
import { ScopeRegistry } from '../oauth/scope-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminGuard, Auth } from '../sessions/auth.guard';
import { SessionsService, type SessionWithUser } from '../sessions/sessions.service';
import { assertNotProtected } from '../users/demo-guard';
import type { Prisma } from '../generated/prisma/client';
import { ClientsService } from './clients.service';
import { toAuditInfo, toClientSummary, toKeyInfo, toSessionInfo, toUserSummary } from './mappers';

const DAY_MS = 24 * 60 * 60 * 1000;

@ApiTags('Admin')
@ApiCookieAuth()
@UseGuards(AdminGuard)
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly keys: KeysService,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
    private readonly scopes: ScopeRegistry,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------------ dashboard

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard totals, logins per day (14 days) and recent events' })
  async stats(): Promise<DashboardStats> {
    const now = new Date();
    const since = new Date(now.getTime() - 13 * DAY_MS);
    since.setUTCHours(0, 0, 0, 0);
    const [users, clients, activeSessions, activeGrants, mfaUsers, recent, alerts, rows] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.client.count(),
      this.prisma.session.count({ where: { status: 'ACTIVE', revokedAt: null, expiresAt: { gt: now } } }),
      this.prisma.grant.count({ where: { revokedAt: null, userId: { not: null } } }),
      this.prisma.user.count({ where: { totpEnabledAt: { not: null } } }),
      this.prisma.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
      this.prisma.auditEvent.count({
        where: {
          createdAt: { gt: new Date(now.getTime() - DAY_MS) },
          type: { in: ['token.reuse_detected', 'token.code_reuse_detected', 'user.locked', 'mfa.failed'] },
        },
      }),
      this.prisma.$queryRaw<{ day: Date; type: string; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, type, count(*)::bigint AS count
        FROM "AuditEvent"
        WHERE type IN ('user.login', 'user.login_failed') AND "createdAt" >= ${since}
        GROUP BY 1, 2`,
    ]);
    const byDay = new Map<string, { success: number; failure: number }>();
    for (let i = 0; i < 14; i++) {
      byDay.set(new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10), { success: 0, failure: 0 });
    }
    for (const r of rows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      const bucket = byDay.get(key);
      if (!bucket) continue;
      if (r.type === 'user.login') bucket.success += Number(r.count);
      else bucket.failure += Number(r.count);
    }
    return {
      totals: { users, clients, activeSessions, activeGrants, mfaUsers },
      loginsByDay: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      recentEvents: recent.map(toAuditInfo),
      securityAlerts24h: alerts,
      demoMode: this.env.DEMO_MODE,
    };
  }

  // ------------------------------------------------------------------ clients

  @Get('clients')
  @ApiOperation({ summary: 'List OAuth clients' })
  async listClients(): Promise<ClientSummary[]> {
    const rows = await this.prisma.client.findMany({
      orderBy: { createdAt: 'asc' },
      include: { roles: { orderBy: { name: 'asc' } } },
    });
    return rows.map(toClientSummary);
  }

  @Post('clients')
  @ApiOperation({ summary: 'Register a client. The secret of confidential clients is returned once.' })
  async createClient(
    @Body(new ZodPipe(createClientSchema)) body: CreateClientInput,
    @Auth() s: SessionWithUser,
    @Req() req: Request,
  ): Promise<ClientWithSecret> {
    const result = await this.clients.create(body);
    await this.audit.record({
      type: 'client.created',
      actorId: s.userId,
      actorEmail: s.user.email,
      clientId: result.client.clientId,
      meta: requestMeta(req),
      metadata: { type: body.type, grantTypes: body.grantTypes },
    });
    return result;
  }

  @Get('clients/:id')
  async getClient(@Param('id', ParseUUIDPipe) id: string): Promise<ClientSummary> {
    return toClientSummary(await this.clients.get(id));
  }

  @Patch('clients/:id')
  async updateClient(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateClientSchema)) body: UpdateClientInput,
    @Auth() s: SessionWithUser,
    @Req() req: Request,
  ): Promise<ClientSummary> {
    const updated = await this.clients.update(id, body);
    await this.audit.record({
      type: 'client.updated',
      actorId: s.userId,
      actorEmail: s.user.email,
      clientId: updated.clientId,
      meta: requestMeta(req),
      metadata: { fields: Object.keys(body) },
    });
    return updated;
  }

  @Post('clients/:id/secret')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generate a new client secret (the old one stops working immediately)' })
  async rotateSecret(
    @Param('id', ParseUUIDPipe) id: string,
    @Auth() s: SessionWithUser,
    @Req() req: Request,
  ): Promise<ClientWithSecret> {
    const result = await this.clients.rotateSecret(id);
    await this.audit.record({
      type: 'client.secret_rotated',
      actorId: s.userId,
      actorEmail: s.user.email,
      clientId: result.client.clientId,
      meta: requestMeta(req),
    });
    return result;
  }

  @Delete('clients/:id')
  async deleteClient(@Param('id', ParseUUIDPipe) id: string, @Auth() s: SessionWithUser, @Req() req: Request) {
    const removed = await this.clients.remove(id);
    await this.audit.record({
      type: 'client.deleted',
      actorId: s.userId,
      actorEmail: s.user.email,
      clientId: removed.clientId,
      meta: requestMeta(req),
    });
    return { ok: true };
  }

  @Post('clients/:id/roles')
  @ApiOperation({ summary: 'Define a client role (emitted in resource_access.<client>.roles)' })
  async createRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createClientRoleSchema)) body: z.infer<typeof createClientRoleSchema>,
  ) {
    await this.clients.get(id);
    const exists = await this.prisma.clientRole.findUnique({
      where: { clientId_name: { clientId: id, name: body.name } },
    });
    if (exists) throw new ApiError(HttpStatus.CONFLICT, 'role_exists', 'A role with this name already exists');
    return this.prisma.clientRole.create({
      data: { clientId: id, name: body.name, description: body.description ?? null },
    });
  }

  @Delete('clients/:id/roles/:roleId')
  async deleteRole(@Param('id', ParseUUIDPipe) id: string, @Param('roleId', ParseUUIDPipe) roleId: string) {
    const client = await this.clients.get(id);
    assertNotProtected(this.env, client, 'This client');
    await this.prisma.clientRole.deleteMany({ where: { id: roleId, clientId: id } });
    return { ok: true };
  }

  // ------------------------------------------------------------------ users

  @Get('users')
  async listUsers(
    @Query(new ZodPipe(userListQuerySchema)) q: z.infer<typeof userListQuerySchema>,
  ): Promise<Paginated<AdminUserSummary>> {
    const where: Prisma.UserWhereInput = q.q
      ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(toUserSummary), total, page: q.page, pageSize: q.pageSize };
  }

  private async loadUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found', 'User not found');
    return user;
  }

  @Get('users/:id')
  async getUser(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetail> {
    const user = await this.loadUser(id);
    const [sessions, clientRoles, consents] = await Promise.all([
      this.sessions.listForUser(id),
      this.prisma.userClientRole.findMany({
        where: { userId: id },
        include: { clientRole: { include: { client: true } } },
      }),
      this.prisma.consent.findMany({ where: { userId: id }, include: { client: true } }),
    ]);
    return {
      ...toUserSummary(user),
      failedLoginCount: user.failedLoginCount,
      disabledReason: user.disabledReason,
      sessions: sessions.map((s) => toSessionInfo(s)),
      clientRoles: clientRoles.map((r) => ({
        id: r.clientRole.id,
        name: r.clientRole.name,
        clientId: r.clientRole.client.clientId,
        clientName: r.clientRole.client.name,
      })),
      apps: consents.map((c) => ({
        clientId: c.client.clientId,
        name: c.client.name,
        scopes: c.scopes,
        grantedAt: c.updatedAt.toISOString(),
      })),
    };
  }

  @Post('users/:id/lock')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable an account, sign it out everywhere and revoke its tokens' })
  async lockUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(lockUserSchema)) body: z.infer<typeof lockUserSchema>,
    @Auth() s: SessionWithUser,
    @Req() req: Request,
  ) {
    const user = await this.loadUser(id);
    if (user.id === s.userId)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'self_lock', 'You cannot lock your own account');
    assertNotProtected(this.env, user, 'This demo account');
    await this.prisma.user.update({
      where: { id },
      data: { disabledAt: new Date(), disabledReason: body.reason ?? null },
    });
    await this.auth.revokeEverything(id);
    await this.audit.record({
      type: 'admin.user_locked',
      actorId: s.userId,
      actorEmail: s.user.email,
      subjectId: id,
      meta: requestMeta(req),
      metadata: { reason: body.reason },
    });
    return { ok: true };
  }

  @Post('users/:id/unlock')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-enable an account and clear any brute-force lockout' })
  async unlockUser(@Param('id', ParseUUIDPipe) id: string, @Auth() s: SessionWithUser, @Req() req: Request) {
    await this.loadUser(id);
    await this.prisma.user.update({
      where: { id },
      data: { disabledAt: null, disabledReason: null, lockedUntil: null, failedLoginCount: 0 },
    });
    await this.audit.record({
      type: 'admin.user_unlocked',
      actorId: s.userId,
      actorEmail: s.user.email,
      subjectId: id,
      meta: requestMeta(req),
    });
    return { ok: true };
  }

  @Post('users/:id/reset-mfa')
  @HttpCode(200)
  async resetMfa(@Param('id', ParseUUIDPipe) id: string, @Auth() s: SessionWithUser, @Req() req: Request) {
    const user = await this.loadUser(id);
    assertNotProtected(this.env, user, 'This demo account');
    await this.mfa.disable(id);
    await this.audit.record({
      type: 'admin.user_mfa_reset',
      actorId: s.userId,
      actorEmail: s.user.email,
      subjectId: id,
      meta: requestMeta(req),
    });
    return { ok: true };
  }

  @Post('users/:id/revoke-sessions')
  @HttpCode(200)
  async revokeUserSessions(@Param('id', ParseUUIDPipe) id: string, @Auth() s: SessionWithUser, @Req() req: Request) {
    await this.loadUser(id);
    const count = await this.sessions.revoke({ userId: id, excludeId: s.id });
    await this.audit.record({
      type: 'admin.sessions_revoked',
      actorId: s.userId,
      actorEmail: s.user.email,
      subjectId: id,
      meta: requestMeta(req),
      metadata: { count },
    });
    return { revoked: count };
  }

  @Patch('users/:id/roles')
  async setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserRolesSchema)) body: z.infer<typeof updateUserRolesSchema>,
    @Auth() s: SessionWithUser,
    @Req() req: Request,
  ): Promise<AdminUserSummary> {
    const user = await this.loadUser(id);
    assertNotProtected(this.env, user, 'This demo account');
    if (id === s.userId && !body.roles.includes('ADMIN')) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'self_demote', 'You cannot remove your own admin role');
    }
    const updated = await this.prisma.user.update({ where: { id }, data: { roles: [...new Set(body.roles)] } });
    await this.audit.record({
      type: 'admin.user_roles_changed',
      actorId: s.userId,
      actorEmail: s.user.email,
      subjectId: id,
      meta: requestMeta(req),
      metadata: { from: user.roles, to: updated.roles },
    });
    return toUserSummary(updated);
  }

  @Post('users/:id/client-roles')
  @HttpCode(200)
  async assignClientRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(assignClientRoleSchema)) body: z.infer<typeof assignClientRoleSchema>,
    @Auth() s: SessionWithUser,
    @Req() req: Request,
  ) {
    await this.loadUser(id);
    const role = await this.prisma.clientRole.findUnique({
      where: { id: body.clientRoleId },
      include: { client: true },
    });
    if (!role) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found', 'Role not found');
    await this.prisma.userClientRole.upsert({
      where: { userId_clientRoleId: { userId: id, clientRoleId: role.id } },
      create: { userId: id, clientRoleId: role.id },
      update: {},
    });
    await this.audit.record({
      type: 'admin.user_roles_changed',
      actorId: s.userId,
      actorEmail: s.user.email,
      subjectId: id,
      clientId: role.client.clientId,
      meta: requestMeta(req),
      metadata: { added: role.name },
    });
    return { ok: true };
  }

  @Delete('users/:id/client-roles/:roleId')
  async removeClientRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Auth() s: SessionWithUser,
    @Req() req: Request,
  ) {
    const user = await this.loadUser(id);
    assertNotProtected(this.env, user, 'This demo account');
    await this.prisma.userClientRole.deleteMany({ where: { userId: id, clientRoleId: roleId } });
    await this.audit.record({
      type: 'admin.user_roles_changed',
      actorId: s.userId,
      actorEmail: s.user.email,
      subjectId: id,
      meta: requestMeta(req),
      metadata: { removedRoleId: roleId },
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ keys

  @Get('keys')
  async listKeys(): Promise<SigningKeyInfo[]> {
    await this.keys.getActiveKey();
    return (await this.keys.list()).map((k) => toKeyInfo(k));
  }

  @Post('keys/rotate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the signing key. The previous key stays in the JWKS until it expires.' })
  async rotateKeys(@Auth() s: SessionWithUser, @Req() req: Request): Promise<SigningKeyInfo[]> {
    const result = await this.keys.rotate();
    await this.audit.record({
      type: 'key.rotated',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
      metadata: result,
    });
    return (await this.keys.list()).map((k) => toKeyInfo(k));
  }

  // ------------------------------------------------------------------ audit

  @Get('audit')
  @ApiOperation({ summary: 'Audit log with filters and cursor pagination' })
  async auditLog(@Query(new ZodPipe(auditQuerySchema)) q: AuditQuery): Promise<CursorPage<AuditEventInfo>> {
    const where: Prisma.AuditEventWhereInput = {
      ...(q.type ? (q.type.endsWith('.') ? { type: { startsWith: q.type } } : { type: q.type }) : {}),
      ...(q.success ? { success: q.success === 'true' } : {}),
      ...(q.q
        ? {
            OR: [
              { actorEmail: { contains: q.q, mode: 'insensitive' } },
              { clientId: { contains: q.q, mode: 'insensitive' } },
              { ip: { contains: q.q } },
            ],
          }
        : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    return { items: items.map(toAuditInfo), nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  // ------------------------------------------------------------------ outbox

  @Get('outbox')
  @ApiOperation({ summary: 'Dev mail outbox (emails are stored instead of delivered)' })
  async outbox(): Promise<OutboxEmailInfo[]> {
    const rows = await this.prisma.outboxEmail.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  // ------------------------------------------------------------------ scopes

  @Get('scopes')
  async listScopes(): Promise<ScopeInfo[]> {
    const rows = await this.prisma.scope.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem }));
  }

  @Post('scopes')
  async createScope(
    @Body(new ZodPipe(createScopeSchema)) body: z.infer<typeof createScopeSchema>,
    @Auth() s: SessionWithUser,
    @Req() req: Request,
  ): Promise<ScopeInfo> {
    const exists = await this.prisma.scope.findUnique({ where: { name: body.name } });
    if (exists) throw new ApiError(HttpStatus.CONFLICT, 'scope_exists', 'That scope already exists');
    const row = await this.prisma.scope.create({ data: { name: body.name, description: body.description } });
    this.scopes.invalidate();
    await this.audit.record({
      type: 'scope.created',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
      metadata: { name: body.name },
    });
    return { id: row.id, name: row.name, description: row.description, isSystem: row.isSystem };
  }

  @Delete('scopes/:id')
  async deleteScope(@Param('id', ParseUUIDPipe) id: string, @Auth() s: SessionWithUser, @Req() req: Request) {
    const scope = await this.prisma.scope.findUnique({ where: { id } });
    if (!scope) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found', 'Scope not found');
    if (scope.isSystem) throw new ApiError(HttpStatus.BAD_REQUEST, 'system_scope', 'Built-in scopes cannot be deleted');
    const inUse = await this.prisma.client.count({ where: { allowedScopes: { has: scope.name } } });
    if (inUse) throw new ApiError(HttpStatus.CONFLICT, 'scope_in_use', `Scope is used by ${inUse} client(s)`);
    await this.prisma.scope.delete({ where: { id } });
    this.scopes.invalidate();
    await this.audit.record({
      type: 'scope.deleted',
      actorId: s.userId,
      actorEmail: s.user.email,
      meta: requestMeta(req),
      metadata: { name: scope.name },
    });
    return { ok: true };
  }
}
