import { APP_ID, PATHS, appleTeamId } from '@/lib/appLinks'

/* iOS Universal Links — see lib/appLinks.ts. Apple fetches this exact path,
   with no redirect, and wants JSON (no file extension). */
export const dynamic = 'force-dynamic'

export function GET() {
  const team = appleTeamId()
  if (!team) return new Response('Not configured', { status: 404 })
  return Response.json(
    { applinks: { details: [{ appIDs: [`${team}.${APP_ID}`], components: PATHS.map(p => ({ '/': p })) }] } },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
