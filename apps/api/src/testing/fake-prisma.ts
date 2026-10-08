/* Minimal in-memory stand-in for PrismaClient, used by unit tests only. */
import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const RELATIONS: Record<string, Record<string, [model: string, fk: string]>> = {
  refreshToken: { grant: ['grant', 'grantId'] },
  accessToken: { grant: ['grant', 'grantId'] },
  grant: { user: ['user', 'userId'], client: ['client', 'clientId'] },
  userClientRole: { clientRole: ['clientRole', 'clientRoleId'] },
  session: { user: ['user', 'userId'] },
};

function matchValue(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond === 'object' && cond !== null && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ('in' in c) return (c.in as unknown[]).includes(value);
    if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
    if ('not' in c) return !matchValue(value, c.not);
    if ('has' in c) return Array.isArray(value) && value.includes(c.has);
    if ('gt' in c) return value != null && (value as number) > (c.gt as number);
    if ('lt' in c) return value != null && (value as number) < (c.lt as number);
    return Object.entries(c).every(([k, v]) => matchValue((value as Row | undefined)?.[k], v));
  }
  return value === cond;
}

export function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((w) => matches(row, w));
    if (key === 'AND') return (cond as Where[]).every((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, cond as Where);
    return matchValue(row[key], cond);
  });
}

function applyData(row: Row, data: Row): Row {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && 'increment' in v) {
      row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
    } else {
      row[k] = v;
    }
  }
  return row;
}

export class FakePrisma {
  readonly tables: Record<string, Row[]> = {};

  constructor(private readonly defaults: Record<string, () => Row> = {}) {
    return new Proxy(this, {
      get: (target, prop: string) => {
        if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
        return target.model(prop);
      },
    });
  }

  table(name: string): Row[] {
    return (this.tables[name] ??= []);
  }

  private hydrate(model: string, row: Row, include?: Record<string, unknown>): Row {
    if (!include) return { ...row };
    const out: Row = { ...row };
    for (const [rel, spec] of Object.entries(include)) {
      const relation = RELATIONS[model]?.[rel];
      if (!relation) continue;
      const [target, fk] = relation;
      const related = this.table(target).find((r) => r.id === row[fk]) ?? null;
      out[rel] =
        related && typeof spec === 'object'
          ? this.hydrate(target, related, (spec as { include?: Record<string, unknown> }).include)
          : related && { ...related };
    }
    return out;
  }

  model(name: string) {
    const rows = () => this.table(name);
    const sort = (list: Row[], orderBy?: Record<string, 'asc' | 'desc'>) => {
      if (!orderBy) return list;
      const [[key, dir]] = Object.entries(orderBy) as [[string, 'asc' | 'desc']];
      return [...list].sort((a, b) => ((a[key] as number) > (b[key] as number) ? 1 : -1) * (dir === 'desc' ? -1 : 1));
    };
    return {
      findUnique: async ({ where, include }: { where: Where; include?: Record<string, unknown> }) => {
        const row = rows().find((r) => matches(r, where));
        return row ? this.hydrate(name, row, include) : null;
      },
      findFirst: async ({
        where,
        orderBy,
        include,
      }: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'>; include?: Record<string, unknown> } = {}) => {
        const row = sort(
          rows().filter((r) => matches(r, where)),
          orderBy,
        )[0];
        return row ? this.hydrate(name, row, include) : null;
      },
      findMany: async ({
        where,
        orderBy,
        include,
      }: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'>; include?: Record<string, unknown> } = {}) =>
        sort(
          rows().filter((r) => matches(r, where)),
          orderBy,
        ).map((r) => this.hydrate(name, r, include)),
      count: async ({ where }: { where?: Where } = {}) => rows().filter((r) => matches(r, where)).length,
      create: async ({ data }: { data: Row }) => {
        const row = applyData({ id: randomUUID(), createdAt: new Date(), ...(this.defaults[name]?.() ?? {}) }, data);
        rows().push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const row = rows().find((r) => matches(r, where));
        if (!row) throw new Error(`${name} not found`);
        return { ...applyData(row, data) };
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const hits = rows().filter((r) => matches(r, where));
        hits.forEach((r) => applyData(r, data));
        return { count: hits.length };
      },
      deleteMany: async ({ where }: { where?: Where } = {}) => {
        const keep = rows().filter((r) => !matches(r, where));
        const count = rows().length - keep.length;
        this.tables[name] = keep;
        return { count };
      },
    };
  }

  async $transaction(arg: unknown): Promise<unknown> {
    if (typeof arg === 'function') return (arg as (tx: this) => Promise<unknown>)(this);
    return Promise.all(arg as Promise<unknown>[]);
  }

  async $executeRaw(): Promise<number> {
    return 0;
  }
}
