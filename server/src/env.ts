/**
 * Environment validation. The server refuses to boot with a clear message when anything is missing or malformed,
 * so a misconfiguration never surfaces later as a confusing runtime error.
 */
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Number of reverse proxy hops to trust for client IP and HTTPS detection (0 = none). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must be a mongodb:// or mongodb+srv:// URI'),

    /** Comma separated list of allowed origins, normally exactly one: chrome-extension://<extension id>. */
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
      .pipe(z.array(z.string().regex(/^chrome-extension:\/\/[a-p]{32}$/, 'CORS_ORIGINS entries must be chrome-extension://<32 char id>')).min(1)),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** "true" or "false" forces the choice. Unset means signup is open only until the first account exists. */
    ALLOW_SIGNUP: bool.optional(),

    AI_PROVIDER: z.string().min(1).default('groq'),
    AI_BASE_URL: z.url().default('https://api.groq.com/openai/v1'),
    AI_API_KEY: z.string().min(1, 'AI_API_KEY is required'),
    AI_MODEL: z.string().min(1, 'AI_MODEL is required (see DOCS.md for the current Groq model)'),
    /** Only sent when the model is a reasoning model. Groq accepts low, medium or high for gpt-oss. */
    AI_REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'none']).default('low'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    AI_MAX_OUTPUT_TOKENS_DRAFT: z.coerce.number().int().min(100).max(4000).default(1200),

    /** Shared limiter, sized below the provider's published limits (Groq free tier, gpt-oss-120b). */
    AI_LIMIT_RPM: z.coerce.number().int().min(1).default(25),
    AI_LIMIT_TPM: z.coerce.number().int().min(500).default(7000),
    AI_LIMIT_RPD: z.coerce.number().int().min(1).default(950),
    AI_LIMIT_TPD: z.coerce.number().int().min(1000).default(190_000),
    /** How long a request may queue for limiter capacity before the user gets a "try again in N seconds" error. */
    AI_LIMIT_MAX_WAIT_MS: z.coerce.number().int().min(0).max(60_000).default(15_000),

    /** Sheet drafts per user per UTC day. Each one is a single AI call however many emails the sheet holds. */
    DAILY_DRAFT_CAP: z.coerce.number().int().min(1).default(50),
    /** Saved emails and drafts are deleted this many hours after they are first saved. Sheets download before then. */
    PROSPECT_TTL_HOURS: z.coerce.number().min(0.25).max(720).default(3),

    /** Skip the boot time model availability check (tests only). */
    AI_SKIP_MODEL_CHECK: bool.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.AI_SKIP_MODEL_CHECK) {
      ctx.addIssue({ code: 'custom', path: ['AI_SKIP_MODEL_CHECK'], message: 'must be false in production' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid server environment:\n${lines.join('\n')}\nSee server/.env.example and DOCS.md.`);
  }
  return parsed.data;
}
