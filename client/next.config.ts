import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

/* The SAME three names, in the same order, as the route handler and the admin
   app. Four chains with four different orders and two fallback ports were how
   copying one app's env to the other could break the one copied into — and
   4000 is the exam-tracker's port on the production box. */
const API_BASE = process.env.API_URL
  ?? process.env.NEXT_PUBLIC_API_URL
  ?? process.env.NEXT_PUBLIC_API_BASE_URL
  ?? 'http://localhost:8000'

/* Parse the R2 public URL (set at build time via NEXT_PUBLIC_R2_PUBLIC_URL).
   Falls back to allowing all *.r2.dev subdomains for local dev.           */
const r2PublicUrl  = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''
const r2Hostname   = r2PublicUrl
  ? (() => { try { return new URL(r2PublicUrl).hostname } catch { return '' } })()
  : ''

type RemotePattern = { protocol: 'https' | 'http'; hostname: string; port?: string; pathname?: string }

/* Only the exact bucket host from NEXT_PUBLIC_R2_PUBLIC_URL is allowed.
   Wildcards such as *.r2.dev would let anyone with a free Cloudflare account
   feed arbitrary bytes to the image optimizer on our own origin. */
const r2Patterns: RemotePattern[] = [
  ...(r2Hostname ? [{ protocol: 'https' as const, hostname: r2Hostname }] : []),
]

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
      // Local disk fallback (dev only — when R2 is not configured)
      { protocol: 'http', hostname: 'localhost', port: '8000' },
      ...r2Patterns,
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  /* /api/v1 is served by src/app/api/v1/[...path]/route.ts, which relays the
     visitor's address to the backend for per-person rate limiting (M-11).
     Next resolves afterFiles rewrites BEFORE dynamic routes, so the blanket
     `/api/v1/:path*` rewrite that used to sit here silently replaced that
     handler everywhere — production and dev alike — and the relay was never
     sent: every visitor shared one rate-limit bucket.

     Two things stay on rewrites. The authenticated document uploads, because
     a serverless function caps the request body at 4.5 MB and those accept
     5 MB — and they rate-limit per user already, so the relay buys them
     nothing. And the static /uploads files. The unauthenticated signup
     upload is deliberately NOT here: it goes through the handler, because its
     45-per-hour limit is the one that must not be shared by the whole
     school, and its 3 MB cap fits the function. */
  async rewrites() {
    return [
      {
        source: '/api/v1/uploads/:path((?!signup-doc).*)',
        destination: `${API_BASE}/api/v1/uploads/:path`,
      },
      {
        source: '/uploads/:path*',
        destination: `${API_BASE}/uploads/:path*`,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  // Sentry org + project are optional — needed only for source-map uploads.
  // Set SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN in .env to enable.
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Suppress Sentry build-time output unless CI is running
  silent: !process.env.CI,

  // Upload wider sourcemaps (includes vendor code)
  widenClientFileUpload: true,

  // Tree-shake the Sentry logger in production
  disableLogger: true,

  // Don't instrument Vercel Cron Monitors (not used)
  automaticVercelMonitors: false,
})
