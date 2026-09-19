import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from the caller until a .env is found (supports root or workspace cwd). */
function loadEnvFile() {
  let dir = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envFile = loadEnvFile();

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z.enum(['auto', 'true', 'false']).default('auto'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  COOKIE_DOMAIN: z.string().optional().default(''),
  COOKIE_SECURE: booleanish.default(false),

  CORS_ORIGINS: z.string().optional().default(''),
  TRUST_PROXY: booleanish.default(false),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage/uploads'),
  STORAGE_PUBLIC_BASE_URL: z.string().optional().default(''),
  S3_BUCKET: z.string().optional().default(''),
  S3_REGION: z.string().optional().default(''),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: booleanish.default(false),

  DEMO_TENANT_SLUG: z.string().default('demo-gym'),
  SEED_OWNER_EMAIL: z.string().default('owner@demogym.test'),
  SEED_OWNER_PASSWORD: z.string().default('Demo1234!'),

  // Serve the built SPA from the API process (single service deployment).
  SERVE_WEB_DIST: booleanish.default(true),
  WEB_DIST_DIR: z.string().default(path.resolve(__dirname, '../../../web/dist')),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
  // Fail fast and loudly: a server that boots with missing secrets is worse than
  // one that refuses to start.
  throw new Error(`Invalid environment configuration${envFile ? ` (${envFile})` : ' (no .env found)'}:\n${issues}`);
}

const env = parsed.data;

export const config = Object.freeze({
  ...env,
  envFile,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  isDevelopment: env.NODE_ENV === 'development',
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  databaseSsl: resolveSsl(env),
  /** Secrets must never be serialised (logs, error payloads, /health). */
  public() {
    return {
      env: env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      storage: env.STORAGE_DRIVER,
    };
  },
});

function resolveSsl(e) {
  if (e.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (e.DATABASE_SSL === 'false') return false;
  // "auto": Neon and other managed providers need TLS, local dev does not.
  const url = e.DATABASE_URL;
  if (/[?&]sslmode=disable/.test(url) || /@localhost|@127\.0\.0\.1/.test(url)) return false;
  return { rejectUnauthorized: false };
}

export default config;
