import { APP_ID, androidFingerprints } from '@/lib/appLinks'

/* Android App Links — see lib/appLinks.ts. Android verifies the app's signing
   certificate against this list before letting it open the site's links. */
export const dynamic = 'force-dynamic'

export function GET() {
  const prints = androidFingerprints()
  if (prints.length === 0) return new Response('Not configured', { status: 404 })
  return Response.json(
    [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: APP_ID, sha256_cert_fingerprints: prints },
    }],
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
