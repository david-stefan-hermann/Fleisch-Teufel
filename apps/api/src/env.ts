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
  /** Model for reading food labels (copying printed values): a cheaper one does; defaults to AI_MODEL. */
  AI_LABEL_MODEL: z.string().optional(),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  /**
   * AI spending limit per account in USD over the last 24 hours and the last 30 days (all calls,
   * failed ones included); 0 turns a limit off. Above it the AI routes answer 429 `ai_budget`.
   */
  /** The assistant: OpenAI key for the transcription (without it only typed sentences), models. */
  OPENAI_API_KEY: z.string().optional(),
  TRANSCRIBE_MODEL: z.string().default('gpt-transcribe'),
  ASSISTANT_MODEL: z.string().default('claude-haiku-5-5'),
  ASSISTANT_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  AI_BUDGET_DAY_USD: z.coerce.number().min(0).default(5),
  AI_BUDGET_MONTH_USD: z.coerce.number().min(0).default(50),
  /**
   * Web Push (daily reminder): VAPID key pair (`pnpm --filter @ft/api push:keys` prints one) and the
   * contact the push services may use. Without keys the reminder is simply not offered.
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
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
