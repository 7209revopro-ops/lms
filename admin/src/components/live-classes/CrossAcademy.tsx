'use client'
/* ─────────────────────────────────────────────────────
   One class, more than one academy — what the LISTS have to say about it.

   Two things were missing everywhere a shared class is listed, and they are
   the same omission seen from either side of the door:

     • A guest academy's staff were offered Edit / Delete / Start / End on a
       class they do not own. Managing a class stays with its owner — only
       SEATS are shared — so every one of those routes answers 404 for them.
       A control that is guaranteed to fail should not be drawn at all.

     • Everyone, host and guest alike, read one figure: "15 / 30". True, and
       the wrong question. A host whose own floor is exhausted still saw a
       half-full green bar for a room their own students can no longer enter.

   Both answers come from the same place — WHICH DOOR IS THE VIEWER STANDING
   IN — so they live together here rather than being re-derived per surface.

   THE ONE RULE applies to the panel too: never judge a value from one door
   against another's. The viewer's academy is resolved from the viewer, and
   the class's own academy from the class; the two are only ever compared,
   never substituted for one another.
───────────────────────────────────────────────────── */
import type { LiveClass } from '@/lib/api/liveClasses'
import { useCurrentUser } from '@/lib/api/user'
import { useMyOrganization } from '@/lib/currency'
import { useOrgStore } from '@/store/org.store'

/** 'dubai' → 'Dubai'. Organization.slug is a closed enum (see the backend
    model), so title-casing it is a label, not a guess. */
export function academyLabel(slug?: string | null): string {
  if (!slug) return 'another academy'
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

/** The door the VIEWER is standing in. */
export interface ViewerAcademy {
  /** Undefined for a super admin on "All Orgs", who stands in no single one. */
  slug:    string | undefined
  isSuper: boolean
}

/* Which academy is READING this panel — the same resolution TimezoneScope
   performs for the clock: a super admin follows the org switcher, everyone
   else their own academy.

   A HOOK, so it is called once per component and never inside a list map;
   the card grid resolves it at the top and feeds academyViewOf() below for
   each row. */
export function useViewerAcademy(): ViewerAcademy {
  const { data: user }  = useCurrentUser()
  const { data: myOrg } = useMyOrganization()
  const activeOrgSlug   = useOrgStore(s => s.activeOrgSlug)

  const isSuper = user?.role === 'super_admin'
  return {
    slug:    isSuper ? (activeOrgSlug ?? undefined) : (myOrg?.slug ?? undefined),
    isSuper,
  }
}

export interface AcademyView {
  /** This class admits more than one academy. */
  shared:    boolean
  /** The class belongs to the viewer's academy — so the management routes
      will answer, and the owner-only controls are worth drawing. */
  isHost:    boolean
  /** Seats the viewer's OWN students can still take: their pool plus whatever
      is left of the overflow nobody was promised. null when the class is not
      shared, where the room total already answers the question. */
  mine:      number | null
  /** Who owns the class, for the "shared by …" line a guest is shown. */
  hostLabel: string
}

/** Pure, so a list can call it per row after resolving the viewer once. */
export function academyViewOf(live: LiveClass, viewer: ViewerAcademy): AcademyView {
  /* servesAcademies is owner-first and always has at least one entry, so
     "more than one" is exactly "shared" with no special case for the
     unshared class. */
  const shared = (live.servesAcademies?.length ?? 0) > 1

  /* An UNSHARED class in this viewer's list is theirs by construction — the
     list endpoints only return classes that serve the caller's academy — so
     it is never read-only, even while /my-organization is still in flight.
     That keeps every single-academy panel, which is all of them today,
     behaving exactly as it did. */
  const isHost = !shared
    || viewer.isSuper
    || !live.organizationSlug
    || live.organizationSlug === viewer.slug

  /* A guest is judged against THEIR cohort's counter, never the host's: a
     Bangalore admin reading hostSeatsLeft is being told about seats their
     students are forbidden to take. When no cohort matches the viewer we are
     the host (or a super admin on "All Orgs" reading from the owner's side). */
  const cohort = shared
    ? live.guestCohorts?.find(c => !!c.organizationSlug && c.organizationSlug === viewer.slug)
    : undefined
  const pool = cohort ? cohort.seatsLeft : (shared ? live.hostSeatsLeft : undefined)
  const mine = typeof pool === 'number' ? pool + (live.overflowSeatsLeft ?? 0) : null

  return { shared, isHost, mine, hostLabel: academyLabel(live.organizationSlug) }
}

/** The same answer for a component that renders exactly one class. */
export function useAcademyView(live: LiveClass): AcademyView {
  const viewer = useViewerAcademy()
  return academyViewOf(live, viewer)
}

/* ── Chip: which academies this class serves ───────────
   Sits with the status and type badges, because "whose class is this" belongs
   beside "what kind of class is this" rather than buried in the edit modal. */
export function SharedAcademiesChip({ live }: { live: LiveClass }) {
  const academies = live.servesAcademies ?? []
  if (academies.length < 2) return null

  return (
    <span
      className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
      style={{ background: 'rgba(0,87,184,0.18)', color: '#7FB3FF' }}
      title={`One room, shared with ${academies.length} academies. Each books through its own course.`}>
      Shared · {academies.map(academyLabel).join(' + ')}
    </span>
  )
}

/* ── Why the owner-only controls are not there ─────────
   Drawn in their place rather than leaving a bare gap, because "the buttons
   are missing" and "this class is somebody else's" look identical otherwise,
   and the first reads as a broken page. */
export function GuestReadOnlyNote({ hostLabel }: { hostLabel: string }) {
  return (
    <span
      className="whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-semibold"
      style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)' }}
      title={`${hostLabel} owns this class and is the only academy that can edit, start, end or delete it. Your students' seats and attendance are still yours to manage.`}>
      {hostLabel}&apos;s class · seats only
    </span>
  )
}

/* ── Seat meter colour ─────────────────────────────────
   The bar's WIDTH still reads the room, because "15 of 30 booked" is a true
   statement about the room and nothing else here can be computed honestly —
   the host's original floor is not on the DTO, only what remains of it.

   Its COLOUR reads the viewer's own pool, which is the question an admin is
   actually asking. Green on a class whose host floor and overflow are both
   gone was the misinformation: nothing on the card said those students were
   already locked out. */
export function seatBarColor(fillPct: number, mine: number | null): string {
  if (mine !== null) {
    if (mine <= 0) return '#EF4444'
    if (mine <= 3) return '#F59E0B'
    return '#22C55E'
  }
  return fillPct >= 90 ? '#EF4444' : fillPct >= 70 ? '#F59E0B' : '#22C55E'
}

/* Every door's floor and countdown, as a tooltip on the seat block. The
   per-academy numbers are otherwise reachable only by opening the edit modal,
   which is a long way to go to find out why a room says it is half empty. */
export function seatBreakdown(live: LiveClass): string | undefined {
  if ((live.servesAcademies?.length ?? 0) < 2) return undefined

  const parts: string[] = []
  if (typeof live.hostSeatsLeft === 'number')
    parts.push(`${academyLabel(live.organizationSlug)} (owner) ${live.hostSeatsLeft} left`)
  for (const c of live.guestCohorts ?? []) {
    const left = typeof c.seatsLeft === 'number' ? `${c.seatsLeft}` : '?'
    parts.push(`${academyLabel(c.organizationSlug)} ${left} of ${c.seatFloor} left`)
  }
  if (typeof live.overflowSeatsLeft === 'number')
    parts.push(`Shared overflow ${live.overflowSeatsLeft}`)

  return parts.length ? parts.join(' · ') : undefined
}
