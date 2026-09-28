'use client'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { orgTimeZone, setActiveTimeZone } from '@/lib/timezone'   // side effect: installs the academy-zone formatters
import { useCurrentUser } from '@/lib/api/user'
import { useMyOrganization } from '@/lib/currency'
import { useOrgStore } from '@/store/org.store'
import { useImpersonationStore } from '@/store/impersonation.store'
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

/* Refetches every cached query the instant the org switcher OR impersonation
   changes — no page refresh needed, for either one.

   TWO SIGNALS, THE SAME PROBLEM. AdminTopbar's org switcher does exactly one
   thing on click: `setOrg(...)` on a Zustand store. Starting or ending
   impersonation does exactly one thing too: `startImpersonation(...)` /
   `endImpersonation()` on a DIFFERENT Zustand store. Both stores are read
   fresh by the axios interceptor on every NEW request (src/lib/axios.ts) — as
   the X-Organization-Id header and the impersonation Bearer token,
   respectively — so a page opened after either action was always correct.
   Nothing told React Query that the identity behind the browser tab had
   changed, so every screen already open kept showing whatever it had cached
   from BEFORE — the old org's courses, or the super admin's own name and role
   while a "Viewing as [student]" banner sat right above it — until the admin
   manually reloaded the tab. staleTime is 30s, so even a remount inside that
   window (TimezoneScope below does exactly this on an org change) served the
   stale cache straight back rather than asking the server again.

   ONE invalidateQueries CALL, WITH NO FILTER, NOT A PREFIX LIST. The first
   version of this fix invalidated only queryKey: ['admin'], reasoning that
   every admin query is namespaced that way (CLAUDE.md's own documented
   convention, so the client app's ['courses', ...] keys can never collide
   with this app's if the two ever share a browser tab). That was true and
   remains true for course/student/live-class/booking data — but it missed
   two real keys outside that prefix the moment impersonation was added to
   the same problem:
     · ['auth', 'me'] (useCurrentUser) — genuinely a DIFFERENT person's
       profile while impersonating: GET /admin/auth/me resolves req.user.id
       from the Bearer token's subject, so it returns the impersonated
       account's own name and role. AdminTopbar reads this to decide
       `isSuperAdmin`, which gates whether the org switcher renders at all —
       so a stale identity query is not cosmetic, it can leave a control on
       screen that the backend would now refuse.
     · ['audit-logs', filter] — org-scoped admin data that simply never got
       the 'admin' prefix.
   A hand-maintained prefix list is exactly the kind of thing that silently
   rots as the app grows; the next new query key is one omission away from
   the same bug. An unfiltered invalidateQueries() cannot miss a straggler,
   ever, and costs nothing extra to maintain as queries are added.

   invalidateQueries' default behaviour is exactly right and is left alone:
   only queries a mounted screen is ACTIVELY showing refetch immediately —
   which is bounded by whatever that one screen renders, not by the app's
   whole query surface. Anything cached but not currently on screen is only
   marked stale, and picks up the new org or identity the next time it is
   opened, rather than firing a burst of requests for tabs nobody is looking
   at. */
function ScopedQueriesInvalidator() {
  const queryClient        = useQueryClient()
  const activeOrgId        = useOrgStore(s => s.activeOrgId)
  const impersonationToken = useImpersonationStore(s => s.token)
  /* Skip the FIRST run. On initial load there is nothing cached yet — the
     very first fetch of everything already carries whichever org and
     identity the tab opened with — so invalidating then would only queue a
     second, redundant round of requests for data that has not even arrived
     once. One ref, not two: both signals share the same "already mounted"
     question, and a change to either after mount is real and must refetch. */
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    void queryClient.invalidateQueries()
  }, [activeOrgId, impersonationToken, queryClient])

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
      <ScopedQueriesInvalidator />
      <TimezoneScope>{children}</TimezoneScope>
    </QueryClientProvider>
  )
}
