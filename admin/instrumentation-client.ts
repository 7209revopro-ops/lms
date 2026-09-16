import * as Sentry from '@sentry/nextjs'

/* Redact secret query params (password-reset / verify / login tokens) from any
   URL Sentry serializes, so a single-use reset link in ?token=… never reaches
   Sentry via error events or performance transactions. The reset page also
   strips the token from the address bar on load (history.replaceState) so it
   stays out of Session Replay's ongoing URL capture. */
const SECRET_PARAMS = /([?&](?:token|code|password|secret)=)[^&#]+/gi
function scrubUrl(url: string | undefined): string | undefined {
  return typeof url === 'string' ? url.replace(SECRET_PARAMS, '$1[redacted]') : url
}
/* Navigation / fetch / xhr breadcrumbs carry URLs in data.from/to/url — a
   history.replaceState that strips the token still records a breadcrumb whose
   `from` holds it, so those must be scrubbed too. */
function scrubBreadcrumb(b: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const d = b.data as Record<string, unknown> | undefined
  if (d) for (const k of ['from', 'to', 'url']) {
    if (typeof d[k] === 'string') d[k] = scrubUrl(d[k] as string)
  }
  return b
}
function scrubEventUrls<E extends { request?: { url?: string }; transaction?: unknown; breadcrumbs?: Sentry.Breadcrumb[] }>(event: E): E {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url)
  if (typeof event.transaction === 'string') event.transaction = scrubUrl(event.transaction) ?? event.transaction
  event.breadcrumbs?.forEach(scrubBreadcrumb)
  return event
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  /* Keep secret query params (reset/verify tokens) out of everything Sentry
     serializes: error events, performance transactions, and breadcrumbs (both
     as they are recorded and again on any event they ride along on). */
  beforeBreadcrumb: scrubBreadcrumb,
  beforeSend: scrubEventUrls,
  beforeSendTransaction: scrubEventUrls,

  debug: false,
})
