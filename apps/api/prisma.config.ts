import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// The CLI (migrate/studio) should talk to Postgres directly, bypassing any
// connection pooler (e.g. Neon's pgbouncer endpoint). The application itself
// uses DATABASE_URL (pooled) through the `@prisma/adapter-pg` driver adapter.
// `prisma generate` does not need a database, so a placeholder is fine there.
const url =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: { url },
});
