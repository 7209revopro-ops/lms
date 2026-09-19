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
import { DarkSelect } from '@/components/live-classes/FormWidgets'
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
        <div className="flex-1">
          <DarkSelect
            value={cohort.organizationId}
            disabled={disabled}
            placeholder="Select academy…"
            options={selectable.map(o => ({ value: o.id, label: o.name }))}
            /* Changing the academy invalidates the course, and the course
               invalidates the module. Clearing them is not tidiness — a stale
               courseId from the previous academy is exactly the state the
               server refuses, and the admin would have no idea why. */
            onChange={v => onChange({ ...cohort, organizationId: v, courseId: '', sectionId: undefined })}
          />
        </div>
        {!disabled && (
          <button type="button" onClick={onRemove}
            className="shrink-0 rounded-lg p-2 text-white/50 hover:text-white hover:bg-white/10"
            aria-label="Remove academy">
            <X size={14} />
          </button>
        )}
      </div>

      <DarkSelect
        value={cohort.courseId}
        disabled={disabled || !cohort.organizationId}
        loading={!!cohort.organizationId && loadingCourses}
        loadingText="Loading their courses…"
        placeholder={cohort.organizationId ? 'Their equivalent course…' : 'Pick an academy first…'}
        options={courses.map(c => ({ value: c.id, label: c.title }))}
        onChange={v => onChange({ ...cohort, courseId: v, sectionId: undefined })}
      />

      <div className="flex gap-2">
        <div className="flex-1">
          <DarkSelect
            value={cohort.sectionId ?? ''}
            disabled={disabled || !cohort.courseId}
            placeholder={hostGated ? 'Their module (required)…' : 'Their module (optional)'}
            options={sections.map((sec: { id: string; title: string }) =>
              ({ value: sec.id, label: sec.title }))}
            onChange={v => onChange({ ...cohort, sectionId: v || undefined })}
          />
        </div>
        <input
          type="number" min={seatsHeld ?? 0} max={500}
          className={`${fieldBase} w-28`} style={selectStyle} disabled={disabled}
          /* An empty box stays empty. Number('') is 0, so coercing on every
             keystroke snapped the field to 0 under the caret the moment it was
             cleared — you could not select-all and retype. NaN carries the
             empty state, and the summary reads it as 0, which is what an
             empty floor means anyway. */
          value={Number.isFinite(cohort.seatFloor) ? cohort.seatFloor : ''}
          onChange={e => onChange({
            ...cohort,
            seatFloor: e.target.value === '' ? NaN : Number(e.target.value),
          })}
          aria-label="Seats reserved for this academy"
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
  sessionCapacity, readOnly, heldByOrg, storedFloors, storedCapacity, readOnlySummary,
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
  /** organizationId → the floor as STORED. Present only once the class has
      pools, and its presence is what switches the summary to the allocated
      arithmetic. */
  storedFloors?:    Record<string, number>
  /** Capacity as stored, so a capacity raise in the same save counts towards
      the budget — the server applies it before the cohort plan. */
  storedCapacity?:  number
  /** Pre-rendered rows for a viewer who may not EDIT this. Supplied because
      the editable controls cannot render for them at all: every one of the
      three pickers is fed by a super-admin-only endpoint, so an org admin got
      three placeholders and a shared class looked unconfigured. */
  readOnlySummary?: Array<{ academy: string; seatFloor: number; seatsLeft?: number }>
}) {
  const { data: allOrgs = [] } = useOrganizations(true)
  const floors    = value.reduce((n, c) => n + (Number(c.seatFloor) || 0), 0)
  const overflow  = Number(overflowSeats ?? 0) || 0

  /* TWO DIFFERENT SUMS, because the server does two different things.

     On a class that is not yet shared, create() splits the whole room:
     host = capacity - floors - overflow. That is the arithmetic below.

     On a class that ALREADY has pools, nothing is re-split. A raised floor and
     a new academy are both drawn from the OVERFLOW, and the host floor is
     never touched. Showing the create-time sum there told an admin "this
     academy keeps 60" for an edit the server can only refuse — and since this
     panel is the only check before Save, the feature's most ordinary edit
     dead-ended on a 409 after a green preview.

     Removals are not credited, though they do free seats, because the preview
     cannot know whether one will be allowed: an academy with students in the
     room cannot be dropped. Under-promising is the safe direction. */
  const allocated = !!storedFloors
  const drawn = allocated
    ? value.reduce((n, c) =>
        n + Math.max(0, (Number(c.seatFloor) || 0) - (storedFloors[c.organizationId] ?? 0)), 0)
    : 0
  const budget = allocated
    ? overflow + (sessionCapacity - (storedCapacity ?? sessionCapacity))
    : 0
  const hostSeats = sessionCapacity - floors - overflow
  const over      = allocated ? drawn > budget : hostSeats < 0
  /* Every academy is either already on the class or is the host. */
  const noneLeft  = allOrgs.filter(o =>
    o.id !== hostOrgId && !value.some(c => c.organizationId === o.id)).length === 0

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

      {readOnly && readOnlySummary && readOnlySummary.map((r, i) => (
        <div key={i}
          className="flex items-center justify-between rounded-xl px-3 py-2 text-sm"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="text-white/80">{r.academy}</span>
          <span className="text-[11px] text-white/45">
            {r.seatFloor} seat{r.seatFloor === 1 ? '' : 's'} reserved
            {typeof r.seatsLeft === 'number' && r.seatsLeft !== r.seatFloor
              ? ` · ${r.seatFloor - r.seatsLeft} taken` : ''}
          </span>
        </div>
      ))}

      {!(readOnly && readOnlySummary) && value.map((c, i) => (
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
          /* A row nobody can fill is worse than no row: it names no academy, so
             it fails validation, and its seat count still skews the summary. */
          disabled={noneLeft}
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
              aria-label="Shared overflow seats"
              title="Seats promised to nobody, which any academy may draw on"
              disabled={readOnly || !onOverflowChange}
              value={overflow}
              onChange={e => onOverflowChange?.(Number(e.target.value))}
            />
          </div>
          <p className="text-[11px] text-white/40">
            Seats promised to nobody. Any academy may draw on them once its own floor is gone.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px]">
            {allocated ? (
              <span className="text-white/45">Unpromised{' '}
                <b className={over ? 'text-red-400' : 'text-white/80'}>{Math.max(0, budget - drawn)}</b>
              </span>
            ) : (
              <span className="text-white/45">This academy keeps{' '}
                <b className={over ? 'text-red-400' : 'text-white/80'}>{hostSeats}</b>
              </span>
            )}
            <span className="text-white/45">Guests {floors}</span>
            <span className="text-white/45">Overflow {overflow}</span>
            <span className="text-white/45">of {sessionCapacity}</span>
          </div>
          {over && (
            <p className="text-[11px] text-red-400">
              {allocated
                ? `That needs ${drawn} unpromised seat${drawn === 1 ? '' : 's'}, and `
                  + `${Math.max(0, budget)} ${budget === 1 ? 'is' : 'are'} free. Raise the class `
                  + `capacity, or lower another academy floor first.`
                : `The floors and overflow come to ${floors + overflow}, more seats than this class has.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
