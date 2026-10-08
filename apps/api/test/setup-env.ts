// Environment for the e2e suite. A dedicated database keeps tests away from dev data.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://gatekeeper:gatekeeper@localhost:5435/gatekeeper_test';
process.env.ISSUER_URL = 'http://localhost:3500';
process.env.WEB_URL = 'http://localhost:3500';
process.env.KEY_ENCRYPTION_SECRET = 'e2e-test-key-encryption-secret-0123456789';
process.env.COOKIE_SECURE = 'false';
process.env.DEMO_MODE = 'true';
process.env.SEED_ON_BOOT = 'false';
process.env.MAIL_DRIVER = 'outbox';
