import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

/* Backend origin for the upload rewrite — server-side only, never sent to
   the browser. The SAME three names, in the same order, as the route handler
   and the client app, so whichever of them a deployment set keeps working. */
const API_ORIGIN = process.env.API_URL
  ?? process.env.NEXT_PUBLIC_API_URL
  ?? process.env.NEXT_PUBLIC_API_BASE_URL
  ?? 'http://localhost:8000'

/* Parse the R2 public URL (set at build time via NEXT_PUBLIC_R2_PUBLIC_URL). */
const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''
const r2Hostname  = r2PublicUrl
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
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      // Local disk fallback (dev only — when R2 is not configured)
      { protocol: 'http', hostname: 'localhost', port: '8000' },
      ...r2Patterns,
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  /* /api/v1 is served by src/app/api/v1/[...path]/route.ts, which relays the
     admin's address to the backend for per-person rate limiting (M-11) and
     keeps everything same-origin (cookies without CORS or SameSite trouble).
     Next resolves afterFiles rewrites BEFORE dynamic routes, so the blanket
     `/api/v1/:path*` rewrite that used to sit here silently replaced that
     handler everywhere — production and dev alike — and the relay was never
     sent.

     Uploads stay on a rewrite: a serverless function caps the request body
     at 4.5 MB, course images and documents go up to 10 MB, and every admin
     upload is authenticated, so it rate-limits per user already and the
     relay buys it nothing. The static /uploads files stay too. */
  async rewrites() {
    return [
      {
        source:      '/api/v1/uploads/:path*',
        destination: `${API_ORIGIN}/api/v1/uploads/:path*`,
      },
      {
        source:      '/uploads/:path*',
        destination: `${API_ORIGIN}/uploads/:path*`,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent:  !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    automaticVercelMonitors: false,
  },
})
