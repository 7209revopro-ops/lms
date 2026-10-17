/* Build-time public config (EXPO_PUBLIC_*), set per EAS profile in eas.json
   or in .env.local for `expo start`. Everything here ships in the bundle —
   never a secret. */

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '')

export const env = {
  /** The backend's /api/v1 — the app calls the API directly, never through the website's relay. */
  apiUrl:    apiUrl ?? 'http://10.0.2.2:8000/api/v1',
  appEnv:    (process.env.EXPO_PUBLIC_APP_ENV ?? 'development') as 'development' | 'preview' | 'production',
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN || undefined,
  /** The student website — legal pages, and anything the app hands back to the browser. */
  siteUrl:   (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://lms.deltainstitutions.com').replace(/\/+$/, ''),
} as const
