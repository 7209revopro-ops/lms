import 'dotenv/config'
import * as Sentry from '@sentry/node'

/* ─── Sentry — init before any other imports ──────────
   No-op when SENTRY_DSN is not set. Captures unhandled
   exceptions and Express errors automatically.

   Request data is stripped before it leaves the process.
   Sentry's RequestData integration is on by default and its
   DEFAULT_INCLUDE is { cookies: true, headers: true,
   data: true } — only `ip` follows sendDefaultPii. On this
   API that means every captured 500 ships `Cookie:
   lms_at=<live 15-minute access JWT>` (path '/', so it rides
   every request), or an admin's lms_admin_at, plus the parsed
   JSON body — a plaintext password on a failed login. Vendor
   -side scrubbing is an org toggle that runs only after the
   data has crossed the network, so we do not rely on it.
   url + method + query_string are enough to debug with.

   Naming the integration replaces the default instance of
   the same name; beforeSend is belt-and-braces for any other
   path that attaches request data to an event.              */
if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn:              process.env['SENTRY_DSN'],
    environment:      process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.2 : 1.0,
    sendDefaultPii:   false,
    integrations: [
      Sentry.requestDataIntegration({
        include: { cookies: false, headers: false, data: false, ip: false },
      }),
    ],
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies
        delete event.request.headers
        delete event.request.data
      }
      return event
    },
  })
}

import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import path from 'path'
import { corsOptions } from '@/config/cors.ts'
import { errorMiddleware, notFoundMiddleware } from '@/middleware/error.middleware.ts'
import { logger } from '@/utils/logger.ts'
import apiRouter from '@/routes/index.ts'
import assetProxyRouter from '@/routes/assets.routes.ts'

const app = express()
const isProd = process.env.NODE_ENV === 'production'

/* ─── Trust proxy (for correct IP behind reverse proxy) */
app.set('trust proxy', 1)

/* ─── Security headers (helmet) ──────────────────────
   Sets X-Content-Type-Options, X-Frame-Options,
   X-DNS-Prefetch-Control, X-Download-Options,
   Strict-Transport-Security, Referrer-Policy,
   Cross-Origin-* policies, and a strict CSP suitable
   for a JSON API (no inline scripts allowed). HSTS is
   prod-only so http dev keeps working. */
app.disable('x-powered-by')
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri:    ["'self'"],
        frameAncestors: ["'none'"],
        connectSrc: ["'self'"],
        imgSrc:     ["'self'", 'data:'],
        fontSrc:    ["'self'", 'data:'],
        objectSrc:  ["'none'"],
      },
    },
    /* The API never embeds anyone; let the browser apartmentalise it. */
    crossOriginEmbedderPolicy:  false,    // would break image proxying / external thumbs
    crossOriginResourcePolicy:  { policy: 'cross-origin' },  // frontends on other ports/origins read JSON
    referrerPolicy:             { policy: 'strict-origin-when-cross-origin' },
    /* HSTS only when behind HTTPS (production). 1 year, with subdomains, with preload list eligibility. */
    strictTransportSecurity:    isProd
      ? { maxAge: 365 * 24 * 60 * 60, includeSubDomains: true, preload: true }
      : false,
  }),
)

/* ─── CORS ───────────────────────────────────────── */
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

/* ─── Stripe webhook — raw body (must precede express.json) ──
   Stripe signature verification requires the unmodified body
   bytes. We buffer them as express.raw() then the global JSON
   middleware runs for every other route. */
app.use('/api/v1/webhooks/stripe',    express.raw({ type: 'application/json' }))
app.use('/api/v1/webhooks/razorpay', express.raw({ type: 'application/json' }))
app.use('/api/v1/webhooks/clt',      express.raw({ type: 'application/json' }))

/* ─── Body + cookie parsers ──────────────────────── */
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(cookieParser())

/* ─── Static file serving for uploaded media ────────
   GET /uploads/images/:file → disk at uploads/images/
   GET /uploads/videos/:file → disk at uploads/videos/
   No auth required — URLs are unguessable (random hex).

   EXCEPT uploads/kyc/, which holds passport and national-ID scans (H-11).
   Those are readable only through GET /api/v1/documents/:userId/:field, which
   authorises the caller first. An unguessable URL is not access control: it
   leaks into logs, chat history and browser history, and `immutable` caching
   made it unrevocable. */
/* Matched case-insensitively (P-23). Express route matching is case-sensitive,
   but the filesystem underneath is not on Windows or macOS — so a mount on the
   literal '/uploads/kyc' let '/uploads/KYC/<file>' fall through to
   express.static and serve the scan. Moot on a case-sensitive Linux volume and
   moot once R2_KYC_BUCKET_NAME moves these objects off local disk entirely,
   but the local-disk path is the development default. */
app.use('/uploads', (req, res, next) => {
  if (!/^\/kyc(\/|$)/i.test(req.path)) { next(); return }
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Not found' },
  })
})

app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'uploads'), {
    maxAge: '30d',
    immutable: true,
  }),
)

/* ─── Public asset proxy ─────────────────────────────
   Serves non-protected files (avatars, images) from the now-private R2 bucket.
   Outside /api/v1 so it isn't rate-limited, mirroring the static /uploads mount.
   Refuses paid videos and KYC scans. */
app.use('/assets', assetProxyRouter)

/* ─── Request logging (dev only) ─────────────────── */
if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`)
    next()
  })
}

/* ─── Public key discovery (LMS ↔ CLT Connect) ─────
   Deliberately OUTSIDE /api/v1: JWKS is a well-known URI by RFC 8615, and
   versioning it would defeat the point — CLT is configured with one URL and
   must keep resolving it across API versions.

   Unauthenticated and cacheable by design: it publishes only public keys,
   which is what makes rotation possible without redeploying the other side. */
app.get('/.well-known/jwks.json', async (_req, res) => {
  const { publicJwks } = await import('@/utils/integrationKeys.ts')
  const jwks = await publicJwks()
  /* Short cache: long enough to spare the round trip, short enough that a
     rotation propagates within the hour CLT also caches for. */
  res.set('Cache-Control', 'public, max-age=300')
  res.json(jwks)
})

/* ─── API routes ─────────────────────────────────── */
app.use('/api/v1', apiRouter)

/* ─── 404 + error handlers ───────────────────────── */
app.use(notFoundMiddleware)
/* Sentry must receive errors before our handler formats them */
if (process.env['SENTRY_DSN']) {
  Sentry.setupExpressErrorHandler(app)
}
app.use(errorMiddleware)

export default app
