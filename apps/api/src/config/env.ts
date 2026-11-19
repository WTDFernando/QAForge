import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Public origin users hit for auth (OAuth callbacks). Defaults to WEB_URL since the web app proxies /api/auth. */
  AUTH_BASE_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(16),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  /** 32-byte key (hex or base64) for encrypting environment secrets. Defaults to a key derived from BETTER_AUTH_SECRET. */
  ENCRYPTION_KEY: z.string().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Local driver: directory for uploaded files (relative to the API's working directory). */
  STORAGE_LOCAL_DIR: z.string().default('../../.data/uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('qaforge'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  /** Seconds a signed file URL stays valid. */
  FILE_URL_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
  /** ClamAV (clamd) host; when set, uploads are scanned and unusable until clean. */
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),
  /** Redis-backed rate limiting. Defaults to on, except under NODE_ENV=test. */
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Requests per minute: general API per user (or IP), auth endpoints per IP, AI endpoints per user. */
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_AI_PER_MIN: z.coerce.number().int().min(1).default(20),
  /**
   * Let API tests call private/loopback addresses (e.g. a local app under test). Defaults to on
   * outside production; in production only enable it for a dedicated, isolated runner network.
   */
  AUTOMATION_ALLOW_PRIVATE_NETWORKS: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Public URL of the web app, used in CI responses ("open the run" links). */
  PUBLIC_APP_URL: z.string().url().optional(),
});

/** API tests may reach private addresses only when explicitly allowed (or outside production). */
export function automationAllowsPrivate(e = env()): boolean {
  return e.AUTOMATION_ALLOW_PRIVATE_NETWORKS ?? e.NODE_ENV !== 'production';
}

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}
