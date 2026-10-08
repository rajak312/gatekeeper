import { execSync } from 'node:child_process';

/** Applies migrations to the e2e database once before the suite runs. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://gatekeeper:gatekeeper@localhost:5435/gatekeeper_test';
  execSync('npx prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'inherit',
  });
}
