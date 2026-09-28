'use client'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { orgTimeZone, setActiveTimeZone } from '@/lib/timezone'   // side effect: installs the academy-zone formatters
import { useCurrentUser } from '@/lib/api/user'
import { useMyOrganization } from '@/lib/currency'
import { useOrgStore } from '@/store/org.store'
import { PUBLIC_PATHS } from '@/lib/publicPaths'
import { DevtoolsGuard } from '@/components/security/DevtoolsGuard'
import { ContextMenuGuard } from '@/components/security/ContextMenuGuard'

/* Resolves which academy's clock this session runs on and applies it:
   super admin → the org switcher ("All Orgs" → Dubai); everyone else → their
   own academy. The resolved zone is set synchronously during render (so this
   pass already formats correctly), and keying the subtree on it remounts the
   page when the zone changes — every rendered date re-formats immediately on
   an org switch instead of waiting for the next poll.

   Disabled on PUBLIC_PATHS: this used to fire unconditionally on every page,
   including reset-password — where the admin is, by definition, signed out.
   The resulting 401 (then a second 401 on the refresh it triggered) was
   treated by the axios interceptor as a dead session and hard-redirected the
   admin to /login before they could see the form. A page nobody is signed
   into yet also has no academy of its own to resolve a clock for, so
   skipping this here loses nothing. */
function TimezoneScope({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const isPublic  = PUBLIC_PATHS.has(pathname)
  const { data: user }  = useCurrentUser(!isPublic)
  const activeOrgSlug   = useOrgStore(s => s.activeOrgSlug)
  const { data: myOrg } = useMyOrganization(!isPublic)

  const tz = user?.role === 'super_admin'
    ? orgTimeZone(activeOrgSlug)
    : orgTimeZone(myOrg?.slug)
  setActiveTimeZone(tz)

  return <div key={tz} style={{ display: 'contents' }}>{children}</div>
}

/* Refetches every admin-scoped query the instant the org switcher changes —
   no page refresh needed.

   Before this, AdminTopbar's switcher did exactly one thing: `setOrg(...)` on
   the Zustand store. That store is read fresh by the axios interceptor on
   every NEW request (src/lib/axios.ts), so a page opened after the switch was
   always correct — but nothing told React Query the tenant had changed, so
   every screen already on the page (courses, students, live classes, the
   dashboard tiles) kept showing whatever it had cached from the OLD org until
   the admin manually reloaded the tab. staleTime is 30s, so even a remount
   inside that window would have served the stale cache straight back rather
   than asking the server again.

   The fix is the one thing every admin query already has in common:
   CLAUDE.md's own documented convention is that every admin query key is
   namespaced ['admin', ...] specifically so it can never collide with the
   client app's ['courses', ...] keys if the two ever share a browser tab —
   and that same prefix is what makes ONE invalidateQueries call enough. React
   Query matches by prefix, so ['admin'] reaches every admin-scoped query key
   in the app (verified: no live query anywhere is registered outside that
   prefix) without this file having to know any of their names, and without
   ever touching the super admin's own identity query (useCurrentUser, which
   does not start with 'admin' and does not depend on which org is selected).

   invalidateQueries' default behaviour is exactly right and is left alone:
   queries a mounted screen is actively showing refetch immediately: anything
   cached but not currently on screen is only marked stale, and picks up the
   new org the next time it is opened, rather than firing a burst of requests
   for tabs nobody is looking at. */
function OrgScopedQueries() {
  const queryClient  = useQueryClient()
  const activeOrgId  = useOrgStore(s => s.activeOrgId)
  /* Skip the FIRST run. On initial load there is nothing cached yet — the
     very first fetch of everything already carries whichever org the
     switcher opened on — so invalidating then would only queue a second,
     redundant round of requests for data that has not even arrived once. */
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    void queryClient.invalidateQueries({ queryKey: ['admin'] })
  }, [activeOrgId, queryClient])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  return (
    <QueryClientProvider client={queryClient}>
      <DevtoolsGuard />
      <ContextMenuGuard />
      <OrgScopedQueries />
      <TimezoneScope>{children}</TimezoneScope>
    </QueryClientProvider>
  )
}
