/* ─────────────────────────────────────────────────────
   orgSlugs — organization id → slug, cached

   The admin panel renders every timestamp in an academy's wall clock, and it
   picks the zone from a slug: dubai → Asia/Dubai, bangalore → Asia/Kolkata.
   Until now it only ever knew ONE slug — the viewer's own academy, from
   GET /admin/my-organization — because every class a viewer could see belonged
   to their academy.

   Lending an instructor broke that assumption. A lent instructor legitimately
   sees classes from BOTH academies in one list, so the panel needs the academy
   OF EACH CLASS, not of the viewer. This resolves it for the live-class DTO.

   WHY A CACHE. There are exactly two organizations and `slug` is a closed enum
   on the schema, so a new academy already requires a code change. Reading the
   collection once and holding it is not a staleness risk worth a TTL: the only
   way this map changes is a deploy.

   WHY NOT POPULATE. `organizationId` could be populated on the live-class
   queries instead, but several guards compare it with String(live.organizationId)
   against the caller's org, and populating turns that ObjectId into a document
   whose String() is "[object Object]" — a tenancy check that silently stops
   matching. Resolving the slug beside the id leaves every existing comparison
   untouched.
───────────────────────────────────────────────────── */

let cache: Map<string, string> | null = null
let inflight: Promise<Map<string, string>> | null = null

/* Load the map once. Concurrent callers share one query rather than racing:
   the first request after boot is usually a LIST, and every row in it would
   otherwise trigger its own read. */
export async function ensureOrgSlugs(): Promise<Map<string, string>> {
  if (cache) return cache
  if (inflight) return inflight

  inflight = (async () => {
    const { OrganizationModel } = await import('@/models/schema.ts')
    const orgs = await OrganizationModel.find().select('slug').lean()
    const map = new Map<string, string>()
    for (const o of orgs) {
      const id = (o as { _id?: unknown })._id
      const slug = (o as { slug?: unknown }).slug
      if (id && typeof slug === 'string') map.set(String(id), slug)
    }
    /* An EMPTY result is not cached. A test suite imports the app before it
       seeds its organizations, and a boot-time warm would otherwise freeze an
       empty map in place for the life of the process — every class would then
       report no academy and silently fall back to the viewer's zone, which is
       the bug this exists to fix, made permanent and invisible. */
    if (map.size > 0) cache = map
    return map
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/* Synchronous read, for use inside a DTO mapper that cannot await.

   Returns undefined when the cache is cold or the id is unknown, and every
   caller treats that as "no opinion" and falls back to the viewer's own zone —
   exactly today's behaviour. So a cold cache degrades to the old rendering
   rather than to a wrong one. Warm it with ensureOrgSlugs() before mapping. */
export function orgSlugFor(organizationId: unknown): string | undefined {
  if (!cache || organizationId == null) return undefined
  return cache.get(String(organizationId))
}

/* Tests seed their own organizations into a throwaway database, and the cache
   would otherwise hold the previous run's ids. */
export function resetOrgSlugCache(): void {
  cache = null
  inflight = null
}
