import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  /** Registration is always possible while no user exists; afterwards only with this flag. */
  ALLOW_REGISTRATION: bool,
  /** Registrations per IP and hour (brute-force/spam protection; raised only for automated tests). */
  REGISTER_RATE_LIMIT: z.coerce.number().int().min(1).default(5),
  /** Used for the OFF User-Agent ("FleischTeufel/x (mail)") as requested by Open Food Facts. */
  OFF_CONTACT_EMAIL: z.string().default('fleisch-teufel@example.invalid'),
  OFF_BASE_URL: z.string().url().default('https://world.openfoodfacts.org'),
  OFF_SEARCH_URL: z.string().url().default('https://search.openfoodfacts.org'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Feature flag for the AI photo analysis; defaults to on when a key is present. */
  AI_ENABLED: z.enum(['true', 'false']).optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  /** Static files of the web app (production). */
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema> & { aiEnabled: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${msg}`);
  }
  const env = parsed.data;
  const aiEnabled = env.AI_ENABLED
    ? env.AI_ENABLED === 'true' && !!env.ANTHROPIC_API_KEY
    : !!env.ANTHROPIC_API_KEY;
  return { ...env, aiEnabled };
}
