import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ClientWithSecret, CreateClientInput, UpdateClientInput } from '@gatekeeper/shared';
import { ENV, type Env } from '../config/env';
import { randomToken, sha256 } from '../common/crypto';
import { ApiError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeRegistry } from '../oauth/scope-registry.service';
import { validateRedirectUri } from '../oauth/redirect-uri';
import { assertNotProtected } from '../users/demo-guard';
import type { Client } from '../generated/prisma/client';
import { toClientSummary } from './mappers';

export function generateClientSecret(): { secret: string; hash: string; hint: string } {
  const secret = `gks_${randomToken(32)}`;
  return { secret, hash: sha256(secret), hint: secret.slice(-4) };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'client'
  );
}

interface ClientShape {
  type: 'PUBLIC' | 'CONFIDENTIAL';
  grantTypes: string[];
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  allowedScopes: string[];
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Cross-field validation shared by create and update. */
  async validate(shape: ClientShape): Promise<void> {
    const bad = (message: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_client_metadata', message);
    for (const uri of [...shape.redirectUris, ...shape.postLogoutRedirectUris]) {
      const problem = validateRedirectUri(uri);
      if (problem) throw bad(`Redirect URI "${uri}" ${problem}`);
    }
    if (shape.type === 'PUBLIC' && shape.grantTypes.includes('client_credentials')) {
      throw bad('Public clients cannot use client_credentials (they cannot keep a secret)');
    }
    if (shape.grantTypes.includes('authorization_code') && shape.redirectUris.length === 0) {
      throw bad('The authorization_code grant needs at least one redirect URI');
    }
    if (shape.grantTypes.includes('refresh_token') && !shape.grantTypes.includes('authorization_code')) {
      throw bad('refresh_token requires the authorization_code grant');
    }
    const known = await this.scopes.known();
    const unknown = shape.allowedScopes.filter((s) => !known.has(s));
    if (unknown.length) throw bad(`Unknown scope(s): ${unknown.join(', ')}`);
  }

  async create(input: CreateClientInput): Promise<ClientWithSecret> {
    await this.validate(input);
    const secret = input.type === 'CONFIDENTIAL' ? generateClientSecret() : null;
    const client = await this.prisma.client.create({
      data: {
        clientId: `${slugify(input.name)}-${randomToken(4)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, 'x')}`,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        secretHash: secret?.hash ?? null,
        secretHint: secret?.hint ?? null,
        redirectUris: input.redirectUris,
        postLogoutRedirectUris: input.postLogoutRedirectUris,
        allowedScopes: [...new Set(input.allowedScopes)],
        grantTypes: [...new Set(input.grantTypes)],
        requireConsent: input.requireConsent,
        accessTokenTtl: input.accessTokenTtl,
        refreshTokenTtl: input.refreshTokenTtl,
      },
      include: { roles: true },
    });
    return { client: toClientSummary(client), clientSecret: secret?.secret ?? null };
  }

  async get(
    id: string,
  ): Promise<
    Client & { roles: { id: string; name: string; description: string | null; clientId: string; createdAt: Date }[] }
  > {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { roles: { orderBy: { name: 'asc' } } },
    });
    if (!client) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found', 'Client not found');
    return client;
  }

  async update(id: string, input: UpdateClientInput) {
    const current = await this.get(id);
    if (this.env.DEMO_MODE && current.isProtected) {
      // Allow harmless edits on the shared playground, but nothing that would break it.
      const breaking = ['redirectUris', 'postLogoutRedirectUris', 'grantTypes', 'disabled', 'allowedScopes'] as const;
      if (breaking.some((k) => input[k] !== undefined)) assertNotProtected(this.env, current, 'This client');
    }
    const next: ClientShape = {
      type: current.type,
      grantTypes: input.grantTypes ?? current.grantTypes,
      redirectUris: input.redirectUris ?? current.redirectUris,
      postLogoutRedirectUris: input.postLogoutRedirectUris ?? current.postLogoutRedirectUris,
      allowedScopes: input.allowedScopes ?? current.allowedScopes,
    };
    await this.validate(next);
    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        redirectUris: input.redirectUris,
        postLogoutRedirectUris: input.postLogoutRedirectUris,
        allowedScopes: input.allowedScopes ? [...new Set(input.allowedScopes)] : undefined,
        grantTypes: input.grantTypes ? [...new Set(input.grantTypes)] : undefined,
        requireConsent: input.requireConsent,
        accessTokenTtl: input.accessTokenTtl,
        refreshTokenTtl: input.refreshTokenTtl,
        disabledAt: input.disabled === undefined ? undefined : input.disabled ? new Date() : null,
      },
      include: { roles: { orderBy: { name: 'asc' } } },
    });
    return toClientSummary(updated);
  }

  async rotateSecret(id: string): Promise<ClientWithSecret> {
    const current = await this.get(id);
    assertNotProtected(this.env, current, 'This client');
    if (current.type !== 'CONFIDENTIAL') {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'public_client', 'Public clients do not have a secret');
    }
    const secret = generateClientSecret();
    const updated = await this.prisma.client.update({
      where: { id },
      data: { secretHash: secret.hash, secretHint: secret.hint },
      include: { roles: true },
    });
    return { client: toClientSummary(updated), clientSecret: secret.secret };
  }

  async remove(id: string): Promise<Client> {
    const current = await this.get(id);
    assertNotProtected(this.env, current, 'This client');
    await this.prisma.$transaction([
      this.prisma.interaction.deleteMany({ where: { clientId: id } }),
      this.prisma.client.delete({ where: { id } }),
    ]);
    return current;
  }
}
