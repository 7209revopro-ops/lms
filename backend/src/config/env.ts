import { z } from 'zod'

/* Treat empty strings in .env the same as "not set".
   Without this, STRIPE_SECRET_KEY= (blank) fails min(1). */
const opt = (schema: z.ZodString) =>
  z.preprocess(v => (v === '' ? undefined : v), schema.optional())

const envSchema = z.object({
  /* Server */
  NODE_ENV:  z.enum(['development', 'production', 'test']).default('development'),
  PORT:      z.coerce.number().default(4000),

  /* Database */
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),

  /* JWT */
  JWT_ACCESS_SECRET:   z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET:  z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES_IN:  z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  /* CORS */
  CLIENT_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_URL:  z.string().url().default('http://localhost:3001'),

  /* Bcrypt */
  BCRYPT_ROUNDS: z.coerce.number().min(10).max(14).default(12),

  /* Stripe — all optional; blank lines in .env are treated as unset */
  STRIPE_SECRET_KEY:     opt(z.string().min(1)),
  STRIPE_WEBHOOK_SECRET: opt(z.string().min(1)),
  STRIPE_CURRENCY:       z.string().length(3).default('usd'),

  /* Razorpay — all optional; blank lines treated as unset */
  RAZORPAY_KEY_ID:        opt(z.string().min(1)),
  RAZORPAY_KEY_SECRET:    opt(z.string().min(1)),
  RAZORPAY_WEBHOOK_SECRET: opt(z.string().min(1)),
  RAZORPAY_CURRENCY:      z.string().length(3).default('INR'),

  /* Public URL — used to build absolute file URLs for uploaded media */
  BACKEND_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

  /* Cloudflare R2 object storage — all optional; file uploads disabled when unset */
  R2_ACCOUNT_ID:        opt(z.string().min(1)),
  R2_ACCESS_KEY_ID:     opt(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: opt(z.string().min(1)),
  R2_BUCKET_NAME:       z.string().default('learnos-media'),
  R2_PUBLIC_URL:        opt(z.string().url()),
  /* Lifetime (seconds) of a signed course-video URL. Must exceed the longest
     video so playback doesn't stall mid-stream on an expired URL. Default 6h. */
  R2_VIDEO_URL_TTL:     z.coerce.number().int().min(60).max(86_400).default(21_600),

  /* AI — Ollama (local LLM) */
  OLLAMA_BASE_URL: z.preprocess(v => (v === '' ? undefined : v), z.string().url().default('http://localhost:11434')),
  OLLAMA_MODEL:    z.preprocess(v => (v === '' ? undefined : v), z.string().default('llama3.2:3b')),

  /* Mux — live streaming */
  MUX_TOKEN_ID:       opt(z.string().min(1)),
  MUX_TOKEN_SECRET:   opt(z.string().min(1)),
  MUX_WEBHOOK_SECRET: opt(z.string().min(1)),

  /* Tabby — BNPL gateway for UAE (AED)
     The prefixes are load-bearing. Tabby issues `sk_…` (secret, server only)
     and `pk_…` (public, safe in a browser). Pasting them into each other's
     slots is an easy mistake with two bad outcomes: every API call 401s, and
     the real secret is one copy away from shipping in NEXT_PUBLIC_. Refuse to
     boot rather than let either happen. */
  TABBY_SECRET_KEY:      opt(z.string().min(1).regex(/^sk_/, 'TABBY_SECRET_KEY must start with sk_ (sk_test_… sandbox, sk_… live) — a pk_ value here means the keys are swapped')),
  TABBY_PUBLIC_KEY:      opt(z.string().min(1).regex(/^pk_/, 'TABBY_PUBLIC_KEY must start with pk_ — an sk_ value here is the SECRET key and must never be exposed')),
  TABBY_MERCHANT_CODE:   opt(z.string().min(1)),
  TABBY_WEBHOOK_SECRET:  opt(z.string().min(1)),
  TABBY_CURRENCY:        z.string().length(3).default('AED'),

  /* Abzer (BillXPro) — payment gateway for UAE (AED) */
  ABZER_ACCESS_KEY:      opt(z.string().min(1)),
  ABZER_SECRET_KEY:      opt(z.string().min(1)),
  ABZER_TEMPLATE_CODE:   z.string().default('paymentlink-mail-template'),
  ABZER_WEBHOOK_SECRET:  opt(z.string().min(1)),
  ABZER_BASE_URL:        z.string().default('https://billxpro.com/as/api/v100'),
  ABZER_CURRENCY:        z.string().length(3).default('AED'),

  /* Tamara — BNPL gateway for UAE/GCC (AED) */
  TAMARA_API_KEY:           opt(z.string().min(1)),
  TAMARA_NOTIFICATION_TOKEN: opt(z.string().min(1)),
  /* Production: https://api.tamara.co  |  Sandbox/QA: https://api-sandbox.tamara.co */
  TAMARA_BASE_URL:          z.string().default('https://api-sandbox.tamara.co'),
  TAMARA_CURRENCY:          z.string().length(3).default('AED'),

  /* Fallback conversion rates, used when a course carries no per-currency
     price. Before B-01 those overrides could not be stored at all, so these
     were the ONLY prices any non-USD gateway ever charged — and the INR one
     was a literal in order.service.ts rather than a setting. Defaults match
     the values that were in effect, so nothing reprices on deploy. */
  UAE_EXCHANGE_RATE: z.coerce.number().positive().default(3.67),
  INR_EXCHANGE_RATE: z.coerce.number().positive().default(83),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n')
  parsed.error.issues.forEach(issue => {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`)
  })
  process.exit(1)
}

export const env = parsed.data

export type Env = typeof env
