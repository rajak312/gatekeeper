import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_MS = 30_000;

/** Caches the set of scopes known to the server (system + custom). */
@Injectable()
export class ScopeRegistry {
  private cache: { at: number; scopes: Map<string, string> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Map<string, string>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.scopes;
    const rows = await this.prisma.scope.findMany({ orderBy: { name: 'asc' } });
    const scopes = new Map(rows.map((r) => [r.name, r.description]));
    this.cache = { at: Date.now(), scopes };
    return scopes;
  }

  async known(): Promise<Set<string>> {
    return new Set((await this.all()).keys());
  }

  invalidate(): void {
    this.cache = null;
  }
}
