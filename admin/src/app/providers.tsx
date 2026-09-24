'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
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

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  return (
    <QueryClientProvider client={queryClient}>
      <DevtoolsGuard />
      <ContextMenuGuard />
      <TimezoneScope>{children}</TimezoneScope>
    </QueryClientProvider>
  )
}
