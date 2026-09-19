/* ─────────────────────────────────────────────────────────────────────────
   The student schedule's shared rules.

   Lifted out of class-bookings/page.tsx unchanged when the Course → Module →
   Class hierarchy was added, because the hierarchy has to answer exactly the
   same questions the flat list does — which door am I looking at this class
   through, how many seats are left FOR ME, and what may I do with this slot
   right now. Two copies of those answers would be two chances to disagree,
   and the one the student sees would be whichever copy was wrong.

   Everything here is pure and clock-reading. No React, no fetching.
   ───────────────────────────────────────────────────────────────────────── */
import { APP_TIMEZONE } from '@/lib/timezone'
import type { LiveClass } from '@/lib/api/liveClasses'
import type { MyBooking } from '@/lib/api/bookings'

/* ── The student's own calendar day ─────────────────────────────────────── */

/** The calendar day a moment falls on IN THE STUDENT'S OWN TIMEZONE
    (APP_TIMEZONE = the device zone), as YYYY-MM-DD. A Dubai 11 PM Friday
    class correctly files under Saturday for a student in India — the same
    zone their clock times are rendered in, so labels and times always agree. */
export const zonedKey = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)

export function toZonedDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(d)
}

export function offlineDayOffset(scheduledStart: string): number {
  const todayStr = toZonedDateStr(new Date())
  const lcStr    = toZonedDateStr(new Date(scheduledStart))
  const msPerDay = 86_400_000
  return Math.round((new Date(lcStr).getTime() - new Date(todayStr).getTime()) / msPerDay)
}

/* ── The clock rules ────────────────────────────────────────────────────── */

export type SlotStatus =
  'live'|'booked'|'bookable'|'closed'|'full'|'locked'|'attended'|'missed'|'cancelled'|'ended'

export const LIVE_LEAD_MINS = 15
export function isWithinLiveWindow(lc: LiveClass): boolean {
  const s = new Date(lc.scheduledStart).getTime()
  return Date.now() >= s - LIVE_LEAD_MINS*60_000 && Date.now() < s + (lc.durationMins||60)*60_000
}

/* Booking closes an hour before an online class starts.

   The deadline comes from the server on every session. The local fallback is
   only for payloads written before that field existed — if the two ever
   disagree the SERVER is right, because it is the one that will refuse the
   booking, and a screen that offers a seat the API then rejects is worse than
   one that greys it out early. */
export const BOOKING_CUTOFF_MINS = 60
export function bookingClosedAt(lc: LiveClass): number {
  return lc.bookingClosesAt
    ? new Date(lc.bookingClosesAt).getTime()
    : new Date(lc.scheduledStart).getTime() - BOOKING_CUTOFF_MINS * 60_000
}
export function isBookingClosed(lc: LiveClass): boolean {
  return Date.now() >= bookingClosedAt(lc)
}
export function isPastEnd(lc: LiveClass): boolean {
  return Date.now() >= new Date(lc.scheduledStart).getTime() + (lc.durationMins||60)*60_000
}

/* ── CROSS-ACADEMY: read YOUR door, not the room ──────────────────────────
   On a shared class the room's remainder is not the caller's. The server
   resolves the caller's own door and sends `seatsLeftForYou`; it is absent on
   any class with no allocation in force, which is every unshared class, so the
   fallback is the arithmetic this file always used and nothing changes there.

   Same for the catalogue: a guest reaches the class through their OWN
   academy's course and module, while `course`/`sectionId` still name the
   host's. Filtering and grouping on the host's ids made a booked class vanish
   from the student's own course and programme chips. */
export const seatsLeft  = (lc: LiveClass) => lc.seatsLeftForYou ?? (lc.sessionCapacity - lc.bookedCount)
export const isFull     = (lc: LiveClass) => lc.sessionCapacity > 0 && seatsLeft(lc) <= 0
export const effCourseId = (lc: LiveClass) => lc.yourCohort?.courseId ?? lc.course?.id
export const effProgram  = (lc: LiveClass) => lc.yourCohort?.program  ?? (lc.course as { program?: string } | undefined)?.program

/** The course title of the door the caller came through. */
export const effCourseTitle = (lc: LiveClass): string | undefined =>
  lc.yourCohort?.courseTitle ?? lc.course?.title

/** The course blurb and level of the door the caller came through. Same rule
    as the module's: a guest reads their OWN academy's course, never the
    host's, so there is no fallback across doors. */
export const effCourseDescription = (lc: LiveClass): string | undefined =>
  lc.yourCohort?.courseId ? lc.yourCohort.courseDescription : lc.course?.description
export const effCourseLevel = (lc: LiveClass): string | undefined =>
  lc.yourCohort?.courseId ? lc.yourCohort.courseLevel : lc.course?.level

/** True when this class reached the caller through a GUEST door — i.e. it
    belongs to the other academy and is shared with theirs. */
export const isSharedWithYou = (lc: LiveClass): boolean => !!lc.yourCohort?.courseId

/* THE MODULE THE CALLER REACHES THIS CLASS THROUGH — their own, not the host's.

   effCourseId above has always preferred the guest's door and these never
   did, so a Bangalore student on a shared class was grouped by their own
   COURSE and the host's MODULE: one key mixing two doors, and a module name
   belonging to an academy they are not enrolled in.

   All four fall back to the class's own fields, which is what a host caller
   wants and what every unshared class has. */
export const effSectionId = (lc: LiveClass): string => {
  if (lc.yourCohort?.sectionId) return lc.yourCohort.sectionId
  const s = lc.sectionId
  return typeof s === 'object' && s ? s.id : s ?? ''
}
export const effSectionTitle = (lc: LiveClass): string | undefined => {
  if (lc.yourCohort?.sectionTitle) return lc.yourCohort.sectionTitle
  const s = lc.sectionId
  return typeof s === 'object' && s ? s.title : undefined
}
/** Where the module sits in ITS OWN course. Ordering a guest's module list by
    the host's `section.order` would rank a module of one course by a position
    in another — so the guest door's own order is preferred, and there is no
    fallback across doors: a guest with no order recorded sorts last. */
export const effSectionOrder = (lc: LiveClass): number | undefined => {
  if (lc.yourCohort?.sectionId) return lc.yourCohort.sectionOrder
  const s = lc.sectionId
  return typeof s === 'object' && s ? s.order : undefined
}
export const effSectionDescription = (lc: LiveClass): string | undefined => {
  if (lc.yourCohort?.sectionId) return lc.yourCohort.sectionDescription
  const s = lc.sectionId
  return typeof s === 'object' && s ? s.description : undefined
}

/* ── What the student may do with this slot, right now ──────────────────── */

/* THE ORDER OF THESE RETURNS IS LOAD-BEARING. Read the comments before
   reordering anything: several of them exist because the obvious order gave
   the student an answer that was true but useless. */
export function getSlotStatus(lc: LiveClass, booking: MyBooking|undefined, hasOther: boolean): SlotStatus {
  if (lc.status === 'cancelled') return 'cancelled'

  const isOffline = (lc as any).isOnline === false
  const ended = (): SlotStatus => booking?.status === 'attended' ? 'attended' : booking?.status === 'missed' ? 'missed' : 'ended'

  if (isOffline) {
    if (lc.status === 'ended') return ended()
    const offset = offlineDayOffset(lc.scheduledStart)
    if (offset < 0) return ended()   // past calendar day → ended

    if (offset === 0) {
      // Today — booking window closed; only show existing booking status, no new bookings
      if (booking?.status === 'booked')   return 'booked'
      if (booking?.status === 'attended') return 'attended'
      if (booking?.status === 'missed')   return 'missed'
      return 'locked'   // no booking or cancelled → same-day booking not allowed
    }

    // offset > 0: future day — normal booking logic (book 1+ day in advance)
    if (booking) {
      if (booking.status === 'booked')    return 'booked'
      if (booking.status === 'attended')  return 'attended'
      if (booking.status === 'missed')    return 'missed'
      if (booking.status === 'cancelled') {
        if (hasOther) return 'locked'
        if (isFull(lc)) return 'full'
        return 'bookable'
      }
    }
    if (hasOther) return 'locked'
    if (isFull(lc)) return 'full'
    return 'bookable'
  }

  const pastEnd = isPastEnd(lc)
  const isLive  = lc.status === 'live' || (!pastEnd && isWithinLiveWindow(lc))
  if (lc.status === 'ended' || (pastEnd && !isLive)) return ended()
  if (isLive) return 'live'
  /* A seat already held is unaffected by the deadline — checked BEFORE it, so
     a booked student keeps seeing their booking (and the cancel button) right
     up to the start. The cut-off stops NEW bookings, not existing ones. */
  if (booking) {
    if (booking.status === 'booked')    return 'booked'
    if (booking.status === 'attended')  return 'attended'
    if (booking.status === 'missed')    return 'missed'
    if (booking.status === 'cancelled') {
      if (isBookingClosed(lc)) return 'closed'
      if (hasOther) return 'locked'
      if (isFull(lc)) return 'full'
      return 'bookable'
    }
  }
  /* Ahead of 'full' and 'locked': once the hour has passed the seat count and
     the one-per-slot rule are both beside the point, and "Booking Closed" is
     the only answer that tells the student what actually happened. */
  if (isBookingClosed(lc)) return 'closed'
  if (hasOther) return 'locked'
  if (isFull(lc)) return 'full'
  return 'bookable'
}

export const SC: Record<SlotStatus,{color:string;bg:string;border:string;label:string}> = {
  live:      {color: 'var(--color-danger)',bg:'rgba(239,68,68,0.08)',  border:'rgba(239,68,68,0.22)',  label:'Live Now'},
  closed:    {color: 'var(--color-text-muted)',bg:'var(--color-bg-inset)',border:'var(--color-border)',label:'Booking Closed'},
  booked:    {color: 'var(--color-success)',bg:'rgba(5,150,105,0.08)',  border:'rgba(5,150,105,0.22)',  label:'Reserved'},
  bookable:  {color: 'var(--color-primary)',bg:'rgba(0,87,184,0.08)', border:'rgba(0,87,184,0.22)', label:'Open'},
  full:      {color: 'var(--color-text-muted)',bg:'rgba(107,114,128,0.07)',border:'rgba(107,114,128,0.18)',label:'Full'},
  locked:    {color: 'var(--color-text-muted)',bg:'rgba(107,114,128,0.07)',border:'rgba(107,114,128,0.15)',label:'Locked'},
  attended:  {color: '#2563EB',bg:'rgba(37,99,235,0.08)',  border:'rgba(37,99,235,0.20)',  label:'Attended'},
  missed:    {color: '#D97706',bg:'rgba(217,119,6,0.08)',  border:'rgba(217,119,6,0.20)',  label:'Missed'},
  cancelled: {color: 'var(--color-text-muted)',bg:'rgba(156,163,175,0.06)',border:'rgba(156,163,175,0.15)',label:'Cancelled'},
  ended:     {color: 'var(--color-text-muted)',bg:'rgba(156,163,175,0.06)',border:'rgba(156,163,175,0.15)',label:'Ended'},
}

/* ── Slot groups ────────────────────────────────────────────────────────── */

export interface ClassGroup {
  id:string; title:string; instructor:{id:string;name:string;avatarUrl?:string}|null
  slots:LiveClass[]; bookedSlot:LiveClass|undefined
  courseId?:string; courseTitle?:string; moduleTitle?:string
}

/* A repeat series, as far as the student is concerned: the same class, by the
   same instructor, in the same course, the same module AND THE SAME LANGUAGE.

   BOTH DOORS ARE IN THE KEY VIA THE `eff` READERS, so a group can never span
   two courses or two modules — which is what lets the hierarchy bucket groups
   by course and module without regrouping the raw sessions.

   LANGUAGE IS IN THE KEY because a class taught in two languages is two
   series, not one, and merging them broke three things at once: the module
   sheet groups slots BY language and put the whole merged group under
   whichever language its first session happened to be in, so the other
   language's sessions vanished from a module whose own card still counted
   them ("2 Languages", one slot listed); SlotModal shows a single language
   badge taken from slots[0], which mislabelled every session in the other
   language; and slotPattern could never find a weekly pattern, because two
   interleaved schedules never agree on a weekday, so a genuine "Tuesdays ·
   7:00 PM" slot fell back to listing dates. */
/** The weekday and clock time a session recurs on, in the student's own
    zone. This is what makes one weekly slot one slot. */
const WEEKDAY_NUM = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, weekday: 'short' })
const CLOCK_HM    = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false })
const slotSignature = (lc: LiveClass): string => {
  const d = new Date(lc.scheduledStart)
  return `${WEEKDAY_NUM.format(d)}@${CLOCK_HM.format(d)}`
}

export const groupKeyOf = (lc: LiveClass): string =>
  [
    lc.title.trim(),
    lc.instructor?.id ?? '',
    effCourseId(lc) ?? '',
    effSectionId(lc),
    (lc as { language?: string }).language ?? '',
    /* THE RECURRENCE ITSELF IS PART OF THE IDENTITY.

       Without it, every weekly series of the same class in the same module
       and language collapsed into one group. A module offering Monday 7am,
       Tuesday 8pm, Wednesday 9pm and Saturday 3:30pm — four genuinely
       different weekly cohorts — came out as "1 SLOT" holding sixteen
       sessions, and because those sixteen disagree on weekday, slotPattern
       correctly refused to name one and the card fell back to printing a
       single date. The student was shown one slot where there were four, and
       could not tell which cohort they were joining.

       Keyed on weekday + clock time in the STUDENT'S zone, which is the zone
       the card labels them in, so the grouping and the label can never
       disagree. A rescheduled member now splits into its own group rather
       than suppressing its series' weekday label — which is also truer: it
       really is at a different time now. */
    slotSignature(lc),
  ].join('|')

/** Bucket sessions into slot-groups. Slots ascending by start; `bookedSlot` is
    the one the student holds, if any. Callers sort the groups themselves. */
export function buildGroups(classes: LiveClass[], bookingMap: Map<string, MyBooking>): ClassGroup[] {
  const map = new Map<string, LiveClass[]>()
  classes.forEach(lc => {
    const k = groupKeyOf(lc)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(lc)
  })
  return [...map.entries()].map(([id, slots]) => {
    slots.sort((a,b)=>new Date(a.scheduledStart).getTime()-new Date(b.scheduledStart).getTime())
    const first = slots[0]!
    return {
      id,
      title:       first.title.trim(),
      instructor:  first.instructor ?? null,
      slots,
      bookedSlot:  slots.find(s => bookingMap.get(s.id)?.status === 'booked'),
      courseId:    effCourseId(first),
      courseTitle: effCourseTitle(first),
      moduleTitle: effSectionTitle(first),
    }
  })
}

/* ── What is worth offering as a filter ─────────────────────────── */

export interface SlotFacets {
  languages:   string[]
  instructors: { id: string; name: string; avatarUrl?: string }[]
}

/**
 * The languages and instructors THESE slots actually have.
 *
 * Never the full catalogue of either. A module taught in English and Hindi
 * offers exactly English and Hindi; a picker listing all five languages the
 * system accepts would let a student choose Urdu and be shown an empty
 * screen, which is a filter that can only disappoint.
 *
 * The caller decides whether to render each one, and the rule is
 * `showFacet` below: a filter with one option filters nothing.
 */
export function moduleFacets(groups: ClassGroup[]): SlotFacets {
  const langs = new Set<string>()
  const tutors = new Map<string, { id: string; name: string; avatarUrl?: string }>()
  for (const g of groups) {
    const lang = (g.slots[0] as { language?: string } | undefined)?.language
    if (lang) langs.add(lang)
    /* Read off the GROUP, not the first slot: the group key already includes
       the instructor, so every session in one shares theirs. */
    if (g.instructor && !tutors.has(g.instructor.id)) tutors.set(g.instructor.id, g.instructor)
  }
  return {
    languages:   [...langs].sort(),
    instructors: [...tutors.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** A control that cannot change the answer is furniture. One option — or
    none — means every slot already matches, so the filter is not drawn. */
export const showFacet = (values: unknown[]): boolean => values.length > 1

/** Narrow slots to a chosen language and instructor. `null` means "all". */
export function filterGroups(
  groups: ClassGroup[],
  language: string | null,
  instructorId: string | null,
): ClassGroup[] {
  if (!language && !instructorId) return groups
  return groups.filter(g =>
    (!language     || (g.slots[0] as { language?: string } | undefined)?.language === language) &&
    (!instructorId || g.instructor?.id === instructorId))
}

/* ── How a group describes itself ───────────────────────────────────────── */

const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, weekday: 'long' })
const CLOCK   = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit' })

/**
 * "Tuesdays · 2:00 PM" when every session in the group really does fall on
 * that weekday at that time, and `null` when they do not.
 *
 * A weekly slot is how a student thinks about a recurring class, and it is
 * how the reference product labels one. But it is only honest when the
 * sessions agree: reschedule one member and the pattern is a lie that books
 * the wrong session. So this is DERIVED FROM THE SESSIONS THEMSELVES rather
 * than from `seriesId` — a drifted series simply stops claiming a weekday,
 * and the caller falls back to showing the dates.
 *
 * Read in the student's own zone, like every other time on this screen.
 */
export function slotPattern(slots: LiveClass[]): { weekday: string; time: string } | null {
  if (slots.length === 0) return null
  const first = new Date(slots[0]!.scheduledStart)
  const weekday = WEEKDAY.format(first)
  const time    = CLOCK.format(first)
  for (const s of slots) {
    const d = new Date(s.scheduledStart)
    if (WEEKDAY.format(d) !== weekday || CLOCK.format(d) !== time) return null
  }
  return { weekday, time }
}

/** The next session in a group that has not finished yet, if any. */
export const nextSlot = (slots: LiveClass[]): LiveClass | undefined =>
  slots.find(s => !isPastEnd(s) && s.status !== 'cancelled')

/* ── The catalogue's time policy ────────────────────────────────────────── */

/**
 * THE HIERARCHY IS A CATALOGUE, NOT A DIARY.
 *
 * The flat list is clipped to a Mon–Sun window and answers "what is on this
 * week". The hierarchy answers "what does this module teach and when can I
 * join it", so it ignores the window entirely and shows everything still
 * ahead. Without this the two views disagree by construction and a module
 * card reading "7 Sessions" would be counting sessions from six months ago.
 *
 * A live session counts as ahead of you — it is the one you can join now.
 */
export const isStillAhead = (lc: LiveClass): boolean =>
  lc.status !== 'cancelled' && (!isPastEnd(lc) || isWithinLiveWindow(lc))

/* ── The tree ───────────────────────────────────────────────────────────── */

export interface ModuleNode {
  /** effSectionId — '' for sessions their course files under no module. */
  id:           string
  title:        string
  description?: string
  order?:       number
  /** Every session here is one the admin has blocked this student out of.
      They stay listed, as they always have; they are drawn locked. */
  blocked:      boolean
  languages:    string[]
  groups:       ClassGroup[]
  sessionCount: number
}

export interface CourseNode {
  id:            string
  title:         string
  program?:      string
  description?:  string
  level?:        string
  thumbnailUrl?: string
  /** Reached through a GUEST door — this course belongs to the other academy
      and is shared with yours. */
  shared:        boolean
  /** Whoever is teaching the sessions still ahead — deduped, in the order
      they first appear. A course's "instructor" is a property of the CLASSES
      that are actually scheduled, not of the course document, so a course
      taught by two people says two rather than picking one. */
  instructors:   { id: string; name: string; avatarUrl?: string }[]
  modules:       ModuleNode[]
  sessionCount:  number
}

export const GENERAL_MODULE_ID = ''
const GENERAL = GENERAL_MODULE_ID

/** "1 module" / "2 modules" — screen readers read the aria-label out loud. */
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/**
 * Build the whole tree in one pass over the sessions still ahead.
 *
 * Bucketing by `effCourseId` then `effSectionId` is safe because both are
 * already inside the slot-group key (see groupKeyOf), so a group can never
 * straddle two courses or two modules.
 */
export function buildCatalog(
  classes: LiveClass[],
  bookingMap: Map<string, MyBooking>,
): CourseNode[] {
  const ahead = classes.filter(isStillAhead)
  const groups = buildGroups(ahead, bookingMap)

  const courses = new Map<string, CourseNode>()

  for (const g of groups) {
    const first = g.slots[0]!
    const cid   = effCourseId(first) ?? ''

    let course = courses.get(cid)
    if (!course) {
      course = {
        id:      cid,
        title:       effCourseTitle(first) ?? 'Unassigned sessions',
        program:     effProgram(first),
        description: effCourseDescription(first),
        level:       effCourseLevel(first),
        /* Only ever the HOST's own artwork, and only for a host caller. A
           guest's door names another academy's course by id; showing the
           host's thumbnail beside the guest's course title would put two
           doors in one card. */
        thumbnailUrl: isSharedWithYou(first) ? undefined : first.course?.thumbnailUrl,
        shared:  false,
        instructors: [],
        modules: [],
        sessionCount: 0,
      }
      courses.set(cid, course)
    }
    if (isSharedWithYou(first)) course.shared = true
    const tutor = g.instructor
    if (tutor && !course.instructors.some(i => i.id === tutor.id)) course.instructors.push(tutor)

    const mid = effSectionId(first) || GENERAL
    let mod = course.modules.find(m => m.id === mid)
    if (!mod) {
      mod = {
        id:          mid,
        title:       effSectionTitle(first) ?? 'General sessions',
        description: effSectionDescription(first),
        order:       effSectionOrder(first),
        blocked:     true,          // narrowed below; one open session opens it
        languages:   [],
        groups:      [],
        sessionCount: 0,
      }
      course.modules.push(mod)
    }
    mod.groups.push(g)
    mod.sessionCount += g.slots.length
    course.sessionCount += g.slots.length

    for (const s of g.slots) {
      /* A module is locked only when EVERY session in it is one this student
         is enrolled for and has been blocked out of. A session they simply
         have not bought is not a block — it is a course they have not taken,
         and the booking flow already says so. */
      if (!(s.isEnrolled === true && s.isEntitled === false)) mod.blocked = false
      const lang = (s as { language?: string }).language
      if (lang && !mod.languages.includes(lang)) mod.languages.push(lang)
    }
  }

  for (const c of courses.values()) {
    /* Module 1 before Module 10, by the module's own place in its own course.
       A module with no order recorded sorts after the ordered ones rather
       than at the front, and "General sessions" always sits last — it is the
       leftovers bucket, not chapter zero. */
    c.modules.sort((a, b) => {
      if (a.id === GENERAL) return 1
      if (b.id === GENERAL) return -1
      const ao = a.order ?? Number.MAX_SAFE_INTEGER
      const bo = b.order ?? Number.MAX_SAFE_INTEGER
      return ao !== bo ? ao - bo : a.title.localeCompare(b.title)
    })
    for (const m of c.modules) {
      m.languages.sort()
      m.groups.sort((a, b) => {
        const an = nextSlot(a.slots)?.scheduledStart ?? a.slots[0]!.scheduledStart
        const bn = nextSlot(b.slots)?.scheduledStart ?? b.slots[0]!.scheduledStart
        return new Date(an).getTime() - new Date(bn).getTime()
      })
    }
  }

  return [...courses.values()].sort((a, b) => a.title.localeCompare(b.title))
}
