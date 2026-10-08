import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { safeEqual, sha256 } from '../common/crypto';
import { OAuthError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import type { Client } from '../generated/prisma/client';

export type ClientAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none';

export interface AuthenticatedClient {
  client: Client;
  method: ClientAuthMethod;
}

function decodeBasic(header: string): { id: string; secret: string } | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  try {
    // RFC 6749 §2.3.1: credentials are form-urlencoded before base64.
    return {
      id: decodeURIComponent(decoded.slice(0, idx).replace(/\+/g, ' ')),
      secret: decodeURIComponent(decoded.slice(idx + 1).replace(/\+/g, ' ')),
    };
  } catch {
    return null;
  }
}

/**
 * Client authentication at the token, revocation and introspection endpoints.
 * Confidential clients: client_secret_basic or client_secret_post (exactly one).
 * Public clients: identified by client_id only - PKCE is what protects them.
 */
@Injectable()
export class ClientAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(req: Request): Promise<AuthenticatedClient> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const header = req.headers.authorization;
    const basic = header ? decodeBasic(header) : null;
    if (header && /^Basic/i.test(header) && !basic) throw this.invalidClient(true, 'Malformed Basic credentials');

    const bodyId = typeof body.client_id === 'string' ? body.client_id : undefined;
    const bodySecret = typeof body.client_secret === 'string' ? body.client_secret : undefined;

    if (basic && bodySecret) {
      throw new OAuthError('invalid_request', 'Use only one client authentication method');
    }
    if (basic && bodyId && bodyId !== basic.id) {
      throw new OAuthError('invalid_request', 'client_id does not match the authenticated client');
    }

    const clientId = basic?.id ?? bodyId;
    if (!clientId) throw this.invalidClient(false, 'Client authentication is required');

    const client = await this.prisma.client.findUnique({ where: { clientId } });
    const secret = basic?.secret ?? bodySecret;
    const method: ClientAuthMethod = basic ? 'client_secret_basic' : bodySecret ? 'client_secret_post' : 'none';

    if (!client || client.disabledAt) {
      // Still hash the secret so unknown clients and wrong secrets take similar time.
      if (secret) safeEqual(sha256(secret), sha256('x'));
      throw this.invalidClient(Boolean(basic), 'Client authentication failed');
    }

    if (client.type === 'CONFIDENTIAL') {
      if (!secret || !client.secretHash || !safeEqual(sha256(secret), client.secretHash)) {
        throw this.invalidClient(Boolean(basic), 'Client authentication failed');
      }
    } else if (secret) {
      throw this.invalidClient(Boolean(basic), 'Public clients must not use a client secret');
    }

    return { client, method };
  }

  private invalidClient(usedBasic: boolean, description: string): OAuthError {
    return new OAuthError(
      'invalid_client',
      description,
      401,
      usedBasic ? { 'WWW-Authenticate': 'Basic realm="gatekeeper", charset="UTF-8"' } : {},
    );
  }
}
