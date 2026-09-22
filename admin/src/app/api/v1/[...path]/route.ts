/**
 * Catch-all proxy: forwards every /api/v1/* request to the backend
 * server-to-server and copies the response — every Set-Cookie included —
 * back to the browser.
 *
 * THIS is the API path. Until September 2026 next.config.ts also carried a
 * blanket `/api/v1/:path*` rewrite, and Next resolves afterFiles rewrites
 * BEFORE dynamic routes, so this file never ran anywhere — not in production,
 * not in dev. The address relay below (M-11) was therefore never sent, every
 * admin shared one rate-limit bucket, and the backend said so on every boot
 * ("NO request has ever presented it"). The rewrite now covers only
 * /api/v1/uploads/* — next.config.ts says why — and the static /uploads files.
 *
 * The rest of this file exists because a serverless function is not a
 * transparent pipe, and each item is a real failure mode of a naive proxy:
 *   • fetch follows redirects by itself, so a backend 302 to a presigned
 *     bucket URL would be fetched THROUGH this function — the whole file
 *     streamed via Vercel — instead of handed to the browser.
 *   • fetch decompresses the body but leaves `content-encoding` in the
 *     headers; forward that and the browser tries to gunzip plain text.
 *   • The backend records `user-agent` per session and per device; without
 *     it every login looks like the same unknown device.
 *   • Login sets two cookies. They must be appended one by one — joining
 *     them with a comma is what a generic header copy does.
 */
import { NextRequest, NextResponse } from 'next/server'
import { pickClientIp } from '@/lib/clientIp'

/* The SAME three names, in the same order, as next.config.ts and the client
   app, so whichever of them a deployment set keeps working. Read per
   request (this used to be read once at module load). */
const backendOrigin = () =>
  (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

/* Vercel stops a function at the plan's default (10–15 s) unless told
   otherwise; 60 is inside every plan's ceiling. */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const UPSTREAM_TIMEOUT_MS = 55_000

/* Request headers worth carrying. Everything else — host, connection,
   accept-encoding, x-forwarded-*, sec-* and above all x-lms-* — is either set
   by fetch itself, meaningless past this hop, or must not be forgeable from a
   browser: the relay sets x-lms-*, and only the relay may. */
const FORWARD_REQUEST_HEADERS = [
  'accept', 'accept-language', 'content-type', 'cookie', 'authorization',
  'origin', 'referer', 'user-agent', 'x-organization-id', 'x-refresh-token',
  'x-requested-with', 'if-none-match', 'if-modified-since', 'range',
]

/* Response headers that describe THIS hop rather than the payload.
   content-length and content-encoding go because fetch has already decoded
   the body; set-cookie is handled separately, one header per cookie. */
const DROP_RESPONSE_HEADERS = new Set([
  'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'content-encoding', 'content-length', 'set-cookie',
])

/* getSetCookie() is the only API that yields each Set-Cookie separately.
   Node 20+ has it; the fallback keeps a single cookie working elsewhere. */
function setCookies(h: Headers): string[] {
  const withApi = h as Headers & { getSetCookie?: () => string[] }
  if (typeof withApi.getSetCookie === 'function') return withApi.getSetCookie()
  const one = h.get('set-cookie')
  return one ? [one] : []
}

async function proxy(req: NextRequest): Promise<NextResponse> {
  /* pathname is the raw, still-encoded path. The params array is decoded,
     and re-joining it turns "%2F" or a space into a different URL. */
  const url = `${backendOrigin()}${req.nextUrl.pathname}${req.nextUrl.search}`

  const fwd = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(name)
    if (v) fwd.set(name, v)
  }

  /* Relay the admin's real address so the backend can rate-limit per person
     instead of per proxy (M-11). This fetch is server-to-server, so without it
     every admin looks like this server and they all share one bucket.

     A dedicated header + shared secret is the only relay that survives the hop:
     nginx rewrites X-Real-IP and appends to X-Forwarded-For, and any header a
     browser can set is forgeable by anyone calling the API directly. With
     PROXY_SHARED_SECRET unset nothing is sent and behaviour is unchanged. */
  const proxySecret = process.env.PROXY_SHARED_SECRET
  if (proxySecret) {
    const clientIp = pickClientIp(req.headers)
    if (clientIp) {
      fwd.set('x-lms-client-ip', clientIp)
      fwd.set('x-lms-proxy-secret', proxySecret)
    }
  }

  /* arrayBuffer(), not text(): multipart bodies are binary, and decoding them
     as UTF-8 replaces every invalid sequence with U+FFFD — which destroys the
     magic bytes the backend checks on every uploaded file. */
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const body    = hasBody ? await req.arrayBuffer() : undefined

  const ac    = new AbortController()
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(url, {
      method:   req.method,
      headers:  fwd,
      body,
      redirect: 'manual',
      signal:   ac.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    const timedOut = (err as Error | undefined)?.name === 'AbortError'
    console.error('[api proxy]', req.method, req.nextUrl.pathname, timedOut ? 'upstream timed out' : String(err))
    /* Sentences, not stack traces: the UI shows error.message verbatim. */
    return NextResponse.json(
      {
        success: false,
        error: timedOut
          ? { code: 'PROXY_TIMEOUT', message: 'The server took too long to answer. Please try again.' }
          : { code: 'PROXY_ERROR',   message: 'The service is temporarily unreachable. Please try again in a moment.' },
      },
      { status: timedOut ? 504 : 502 },
    )
  }
  clearTimeout(timer)

  const headers = new Headers()
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) headers.append(key, value)
  })
  for (const cookie of setCookies(upstream.headers)) headers.append('set-cookie', cookie)
  /* Which path answered. The rewrite sets nothing, so this is how an operator
     tells, from a response, that the handler — and the relay — is live. */
  headers.set('x-lms-proxy', 'handler')

  const noBody = req.method === 'HEAD' || upstream.status === 204 || upstream.status === 304
  return new NextResponse(noBody ? null : upstream.body, { status: upstream.status, headers })
}

export const GET     = proxy
export const HEAD    = proxy
export const POST    = proxy
export const PUT     = proxy
export const PATCH   = proxy
export const DELETE  = proxy
export const OPTIONS = proxy
