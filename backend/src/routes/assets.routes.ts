/**
 * Public asset proxy — serves NON-protected files (avatars, images, uploaded
 * documents) streamed from the now-private R2 bucket, so making the bucket
 * private for video protection doesn't break site images.
 *
 * Mounted OUTSIDE /api/v1 (no rate limit, like the static /uploads mount).
 * Paid videos and KYC scans are refused here — they are only reachable via
 * their dedicated signed-URL paths.
 */
import { Router, type Request, type Response } from 'express'
import { getObjectBytes } from '@/services/r2.service.ts'
import { allowedOrigins } from '@/config/cors.ts'

const router = Router()

const BLOCKED_PREFIXES = ['videos/', 'kyc/']

/* ── WHO MAY EMBED A DOCUMENT ────────────────────────────────────────────────
   The global helmet policy is written for a JSON API: `frame-ancestors 'none'`
   plus `X-Frame-Options: SAMEORIGIN`. That is right for every JSON route and
   wrong for this one, because a lesson's PDF handout exists precisely to be
   read inside the student app — and the student app is a different origin
   (:3000) from the API that serves the file (:8000).

   The effect was total: `frame-ancestors 'none'` refuses EVERY origin, its own
   included, so the reader rendered a broken-document icon and no error a
   student could act on. X-Frame-Options would have blocked it a second time on
   its own, cross-port being cross-origin.

   So this route sets its own policy, and it is still a narrow one:
     · frame-ancestors lists OUR front-ends and nothing else — the same list
       CORS already trusts, so the two cannot drift apart. Not '*': letting any
       site frame these documents is a clickjacking surface for no gain.
     · X-Frame-Options is REMOVED rather than widened. It has no multi-origin
       syntax (ALLOW-FROM is dead in every current browser), and where both
       headers are present modern browsers take frame-ancestors anyway. Leaving
       a header that can only say "no" beside one that says "these two" is how
       this comes back.
     · default-src and object-src stay 'none'. Nothing here should load
       anything; it is a byte stream, not a page.

   Images are unaffected either way — nobody frames an <img>. This is for the
   documents. */
const FRAME_ANCESTORS = ["'self'", ...allowedOrigins.filter(Boolean)].join(' ')

router.get('/*', async (req: Request, res: Response): Promise<void> => {
  const key = decodeURIComponent(req.path).replace(/^\/+/, '')
  if (!key || key.includes('..')) { res.status(400).end(); return }
  if (BLOCKED_PREFIXES.some(p => key.startsWith(p))) { res.status(403).end(); return }

  const obj = await getObjectBytes(key)
  if (!obj) { res.status(404).end(); return }

  res.setHeader('Content-Type', obj.contentType ?? 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')

  /* Overrides the API-wide policy for this route only — see FRAME_ANCESTORS. */
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; object-src 'none'; frame-ancestors ${FRAME_ANCESTORS}`)
  res.removeHeader('X-Frame-Options')

  /* A browser that sniffed a .pdf as something else would be a real problem,
     so nosniff stays — the Content-Type above is derived from the VERIFIED
     magic bytes at upload time, not from the filename. */
  res.setHeader('X-Content-Type-Options', 'nosniff')

  /* inline, and with the original-ish name: without a disposition some
     browsers download rather than display, which is the opposite of a reader.
     The name is the stored key's basename, which is random hex plus the
     extension the upload's magic bytes earned — never a client-supplied
     filename. */
  const base = key.split('/').pop() ?? 'file'
  res.setHeader('Content-Disposition', `inline; filename="${base.replace(/[^A-Za-z0-9._-]/g, '')}"`)

  res.end(Buffer.from(obj.body))
})

export default router
