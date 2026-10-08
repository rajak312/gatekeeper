import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { EnvValidationError, loadEnv } from './config/env';

async function main(): Promise<void> {
  // Local development convenience; platforms (Render, Docker) inject real env vars, which take precedence.
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Validate configuration before anything else so misconfiguration fails fast and clearly.
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(`\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, bufferLogs: true });
  configureApp(app);
  await app.listen(env.PORT, '0.0.0.0');
}

void main();
