/**
 * `npm run db:seed` - creates the demo accounts, the playground client and
 * scopes. Pass `--reset` to wipe visitor data first.
 */
import { existsSync } from 'node:fs';
import { createPrismaClient } from '../src/prisma/prisma.service';
import { seedDatabase } from '../src/demo/seed';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient(url);
  try {
    await seedDatabase(prisma, {
      webUrl: process.env.WEB_URL ?? 'http://localhost:3500',
      reset: process.argv.includes('--reset'),
      syntheticHistory: process.env.DEMO_MODE === 'true',
      log: (m) => console.log(`[seed] ${m}`),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
