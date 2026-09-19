'use client'
/* ─────────────────────────────────────────────────────
   One class, more than one academy.

   A cohort is a DOOR: the academy whose students may come in, the course of
   THEIRS they must be enrolled in, and optionally the module of that course.
   Entitlement never compares a value from one door against a value from
   another — a Bangalore student is judged entirely against the Bangalore
   course named here, never against the Dubai one the class belongs to.

   SUPER ADMINS ONLY, and that is a consequence rather than a preference. The
   backend answers CROSS_ACADEMY_FORBIDDEN to anyone else, and it has to:
   #assertCohortsUsable checks that a cohort is coherent and never asks who is
   asking. It also refuses to say whether a course id it rejects belongs to
   another academy or does not exist at all, deliberately, so that one admin
   cannot enumerate another academy's courses by reading the difference. A
   picker that listed them would hand over exactly what that refusal protects —
   which is why the list is fetched with the caller's OWN super-admin rights,
   through the same X-Organization-Id header the org switcher uses, rather than
   through a new endpoint built for this form.

   SEATS. Each academy gets a FLOOR: seats nobody else can take. What is left
   after every floor and the shared overflow belongs to the host. The counters
   are what make the promise real — without a floor, whichever academy opens
   its booking page first takes the room.
───────────────────────────────────────────────────── */
import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { api } from '@/lib/axios'
import { useOrganizations } from '@/lib/api/organizations'
import { useCourseOutline } from '@/lib/api/outline'
import type { GuestCohortInput } from '@/lib/api/liveClasses'

/* Another academy's courses, read with an explicit header for this one
   request. The axios interceptor yields to a caller-set header, so the org
   switcher stays where the admin left it. */
function useCoursesOfOrg(orgId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'courses', 'of-org', orgId ?? ''],
    enabled:  !!orgId,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<{ success: true; data: Array<{ id: string; title: string }> }>(
        '/admin/courses',
        { params: { per_page: 200 }, headers: { 'X-Organization-Id': orgId! } },
      )
      return res.data.data
    },
  })
}

const selectStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' } as const
const fieldBase = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none placeholder:text-white/30'

function CohortRow({
  cohort, onChange, onRemove, hostOrgId, takenOrgIds, hostGated, disabled, seatsHeld,
}: {
  cohort:      GuestCohortInput
  onChange:    (next: GuestCohortInput) => void
  onRemove:    () => void
  hostOrgId:   string | undefined
  takenOrgIds: string[]
  /** The class itself is gated to a module, so every guest must name one too. */
  hostGated:   boolean
  disabled?:   boolean
  /** Seats this academy already holds — a floor cannot go below them. */
  seatsHeld?:  number
}) {
  const { data: orgs = [] } = useOrganizations(true)
  const { data: courses = [], isLoading: loadingCourses } = useCoursesOfOrg(cohort.organizationId || undefined)
  const { data: outline } = useCourseOutline(cohort.courseId || '')
  const sections = outline?.sections ?? []

  /* An academy may appear once, and never the host's own. */
  const selectable = orgs.filter(o =>
    o.id !== hostOrgId && (o.id === cohort.organizationId || !takenOrgIds.includes(o.id)))

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2">
        <select
          className={fieldBase} style={selectStyle} disabled={disabled}
          value={cohort.organizationId}
          /* Changing the academy invalidates the course, and the course
             invalidates the module. Clearing them is not tidiness — a stale
             courseId from the previous academy is exactly the state the server
             refuses, and the admin would have no idea why. */
          onChange={e => onChange({ ...cohort, organizationId: e.target.value, courseId: '', sectionId: undefined })}
        >
          <option value="">Select academy…</option>
          {selectable.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {!disabled && (
          <button type="button" onClick={onRemove}
            className="shrink-0 rounded-lg p-2 text-white/50 hover:text-white hover:bg-white/10"
            aria-label="Remove academy">
            <X size={14} />
          </button>
        )}
      </div>

      <select
        className={fieldBase} style={selectStyle}
        disabled={disabled || !cohort.organizationId || loadingCourses}
        value={cohort.courseId}
        onChange={e => onChange({ ...cohort, courseId: e.target.value, sectionId: undefined })}
      >
        <option value="">
          {!cohort.organizationId ? 'Pick an academy first…'
            : loadingCourses ? 'Loading courses…' : 'Their equivalent course…'}
        </option>
        {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>

      <div className="flex gap-2">
        <select
          className={fieldBase} style={selectStyle}
          disabled={disabled || !cohort.courseId}
          value={cohort.sectionId ?? ''}
          onChange={e => onChange({ ...cohort, sectionId: e.target.value || undefined })}
        >
          <option value="">{hostGated ? 'Their module (required)…' : 'Their module (optional)'}</option>
          {sections.map((s: { id: string; title: string }) =>
            <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <input
          type="number" min={seatsHeld ?? 0} max={500}
          className={`${fieldBase} w-28`} style={selectStyle} disabled={disabled}
          value={cohort.seatFloor}
          /* Number(), not the raw string: the field is typed as a number and
             a string would reach the server and fail its own coercion later,
             for no visible reason. */
          onChange={e => onChange({ ...cohort, seatFloor: Number(e.target.value) })}
          placeholder="Seats"
          title="Seats reserved for this academy"
        />
      </div>

      {hostGated && !cohort.sectionId && (
        <p className="text-[11px] text-amber-300/80">
          This class is gated to a module, so this academy must name one of theirs too.
        </p>
      )}
      {!!seatsHeld && (
        <p className="text-[11px] text-white/40">
          {seatsHeld} seat{seatsHeld === 1 ? '' : 's'} already taken — the floor cannot go below that.
        </p>
      )}
    </div>
  )
}

export function GuestCohortsField({
  value, onChange, hostOrgId, hostGated, overflowSeats, onOverflowChange,
  sessionCapacity, readOnly, heldByOrg,
}: {
  value:            GuestCohortInput[]
  onChange:         (next: GuestCohortInput[]) => void
  hostOrgId:        string | undefined
  hostGated:        boolean
  overflowSeats?:   number
  onOverflowChange?: (n: number) => void
  sessionCapacity:  number
  readOnly?:        boolean
  /** organizationId → seats that academy already holds. Edit path only. */
  heldByOrg?:       Record<string, number>
}) {
  const floors    = value.reduce((n, c) => n + (Number(c.seatFloor) || 0), 0)
  const overflow  = Number(overflowSeats ?? 0) || 0
  const hostSeats = sessionCapacity - floors - overflow
  const over      = hostSeats < 0

  return (
    <div className="space-y-2">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/45">
        Share with another academy
      </label>

      {value.length === 0 && (
        <p className="text-[11px] text-white/40">
          One class, one room. Add an academy and its students can book this session through
          their own course — their seats are reserved separately from yours.
        </p>
      )}

      {value.map((c, i) => (
        <CohortRow
          key={i}
          cohort={c}
          hostOrgId={hostOrgId}
          hostGated={hostGated}
          disabled={readOnly}
          seatsHeld={heldByOrg?.[c.organizationId]}
          takenOrgIds={value.filter((_, j) => j !== i).map(x => x.organizationId).filter(Boolean)}
          onChange={next => onChange(value.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
        />
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={() => onChange([...value, { organizationId: '', courseId: '', seatFloor: 10 }])}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-white/70 hover:text-white hover:bg-white/5"
          style={{ border: '1px dashed rgba(255,255,255,0.15)' }}
        >
          <Plus size={13} /> Add an academy
        </button>
      )}

      {value.length > 0 && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wider text-white/45">Shared overflow</span>
            <input
              type="number" min={0} max={500}
              className="w-24 rounded-lg px-2 py-1 text-sm text-white outline-none"
              style={selectStyle}
              disabled={readOnly || !onOverflowChange}
              value={overflow}
              onChange={e => onOverflowChange?.(Number(e.target.value))}
            />
          </div>
          <p className="text-[11px] text-white/40">
            Seats promised to nobody. Any academy may draw on them once its own floor is gone.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px]">
            <span className="text-white/45">This academy keeps{' '}
              <b className={over ? 'text-red-400' : 'text-white/80'}>{hostSeats}</b>
            </span>
            <span className="text-white/45">Guests {floors}</span>
            <span className="text-white/45">Overflow {overflow}</span>
            <span className="text-white/45">of {sessionCapacity}</span>
          </div>
          {over && (
            <p className="text-[11px] text-red-400">
              The floors and overflow come to {floors + overflow}, more seats than this class has.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
