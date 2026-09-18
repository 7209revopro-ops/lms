/* ─────────────────────────────────────────────────────────────
   reconcile-class-seats — check the seat counters against reality

   `LiveClass.bookedCount` is denormalised: it is incremented and decremented
   alongside the booking rows rather than derived from them. Nothing has ever
   checked the two against each other, and they are known to drift:

     · until this phase, deleting a user left their ClassBooking rows behind and
       never returned the seat, so every deleted student permanently consumed a
       seat of every class they had booked;
     · any crash between the seat reservation and the booking write leaves a
       reserved seat with no row behind it.

   Expect a handful of drifted rows on the first run. That is not a bug in this
   script, it is the backlog it exists to clear.

   It also rebuilds the per-academy allocation. A class that serves more than
   one academy splits its capacity into floors plus a shared overflow; the
   floors are the promise, and the remaining counters have to add back up:

     hostSeatsLeft + Σ guestCohorts[].seatsLeft + overflowSeatsLeft + bookedCount
       === sessionCapacity

   REPORT-ONLY UNLESS --apply, like every other repair script here. Idempotent:
   running it twice changes nothing the second time.

   Usage (from backend/):
     bun src/scripts/reconcile-class-seats.ts
     bun src/scripts/reconcile-class-seats.ts --apply
     bun src/scripts/reconcile-class-seats.ts --apply --id=<liveClassId>
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const APPLY = args.get('apply') === 'true'
const ONLY  = args.get('id')

const uri = process.env['DATABASE_URL']
if (!uri) { console.error('DATABASE_URL is not set'); process.exit(1) }

await mongoose.connect(uri)
const { LiveClassModel, ClassBookingModel } = await import('@/models/schema.ts')

/* A seat is HELD while the booking is live. 'attended' still holds one: the
   student was in the room. 'missed' and 'cancelled' do not. */
const HOLDING = ['booked', 'attended']

interface Drift {
  id:        string
  title:     string
  was:       number
  actual:    number
  pools?:    string
}

const drifted: Drift[] = []
let scanned = 0

const filter = ONLY ? { _id: new mongoose.Types.ObjectId(ONLY) } : {}
/* .lean() IS LOAD-BEARING, NOT AN OPTIMISATION.

   Without it the cursor yields hydrated documents whose guestCohorts are
   Mongoose subdocuments. The repair below builds `{ ...c, seatsLeft }`, and
   spreading a subdocument copies its INTERNALS — __parent, $__, _doc — not its
   fields. The $set then wrote objects with no organizationId and no seatFloor,
   Mongoose dropped them, and the script printed the repair, printed "Applied",
   changed nothing, and reported the same drift on every subsequent run. A
   repair tool that cannot converge is worse than no repair tool, because it
   reports success. */
const cursor = LiveClassModel.find(filter)
  .select('title sessionCapacity bookedCount hostSeatsLeft overflowSeatsLeft guestCohorts')
  .lean()
  .cursor()

for await (const live of cursor) {
  scanned++
  const doc = live as unknown as {
    _id: unknown; title: string; sessionCapacity: number; bookedCount: number
    hostSeatsLeft?: number; overflowSeatsLeft?: number
    guestCohorts?: Array<{ organizationId: unknown; seatFloor: number; seatsLeft: number }>
  }

  const actual = await ClassBookingModel.countDocuments({
    liveClassId: doc._id, status: { $in: HOLDING },
  })

  const allocated = typeof doc.hostSeatsLeft === 'number'
  const cohorts   = doc.guestCohorts ?? []

  /* Unallocated class: the only question is whether the counter matches the
     rows. This is every class that existed before cross-academy sharing. */
  if (!allocated) {
    if (actual !== doc.bookedCount) {
      drifted.push({ id: String(doc._id), title: doc.title, was: doc.bookedCount, actual })
      if (APPLY) {
        await LiveClassModel.updateOne({ _id: doc._id }, { $set: { bookedCount: actual } })
      }
    }
    continue
  }

  /* Allocated class: rebuild the pools from the FLOORS and the seats actually
     held through each door. The floors are the promise and the only durable
     input; the countdowns are derived, so they are recomputed rather than
     trusted. A seat whose door is unknown (booked before the class was shared)
     counts against the host, which is where it came from. */
  const perOrgHeld = new Map<string, number>()
  let overflowHeld = 0
  let hostHeld     = 0

  const seats = await ClassBookingModel.find(
    { liveClassId: doc._id, status: { $in: HOLDING } },
    { seatPoolKind: 1, seatOrganizationId: 1 },
  ).lean()

  for (const s of seats as Array<{ seatPoolKind?: string; seatOrganizationId?: unknown }>) {
    if (s.seatPoolKind === 'overflow') { overflowHeld++; continue }
    if (s.seatPoolKind === 'guest' && s.seatOrganizationId) {
      const k = String(s.seatOrganizationId)
      perOrgHeld.set(k, (perOrgHeld.get(k) ?? 0) + 1)
      continue
    }
    hostHeld++
  }

  /* THE DURABLE INPUTS ARE THE FLOORS, and only the guest floors are stored
     as floors. The overflow floor is reconstructed from its countdown plus the
     seats currently drawn from it, and the host's floor is whatever the
     capacity has left — which is exactly how create() allocated it. Deriving
     in that order means a hand-edited class still reconciles to something
     coherent instead of to whichever counter happened to be least wrong. */
  const guestFloors   = cohorts.reduce((n, c) => n + (c.seatFloor ?? 0), 0)
  const overflowFloor = Math.max(0, (doc.overflowSeatsLeft ?? 0) + overflowHeld)
  const hostFloor     = Math.max(0, doc.sessionCapacity - guestFloors - overflowFloor)

  /* Named explicitly rather than spread, so this cannot silently lose a field
     again if the cohort shape grows. */
  const nextCohorts = cohorts.map(c => ({
    organizationId: (c as { organizationId: unknown }).organizationId,
    courseId:       (c as unknown as { courseId: unknown }).courseId,
    ...((c as unknown as { sectionId?: unknown }).sectionId
      ? { sectionId: (c as unknown as { sectionId?: unknown }).sectionId } : {}),
    seatFloor:      c.seatFloor ?? 0,
    seatsLeft:      Math.max(0, (c.seatFloor ?? 0) - (perOrgHeld.get(String(c.organizationId)) ?? 0)),
  }))
  const nextHost     = Math.max(0, hostFloor - hostHeld)
  const nextOverflow = Math.max(0, overflowFloor - overflowHeld)

  const changed =
    actual !== doc.bookedCount ||
    nextHost !== doc.hostSeatsLeft ||
    nextOverflow !== doc.overflowSeatsLeft ||
    nextCohorts.some((c, i) => c.seatsLeft !== cohorts[i]!.seatsLeft)

  if (changed) {
    drifted.push({
      id: String(doc._id), title: doc.title, was: doc.bookedCount, actual,
      pools: `host ${doc.hostSeatsLeft}→${nextHost}, overflow ${doc.overflowSeatsLeft}→${nextOverflow}`
        + nextCohorts.map((c, i) => `, guest ${cohorts[i]!.seatsLeft}→${c.seatsLeft}`).join(''),
    })
    if (APPLY) {
      await LiveClassModel.updateOne({ _id: doc._id }, {
        $set: {
          bookedCount:       actual,
          hostSeatsLeft:     nextHost,
          overflowSeatsLeft: nextOverflow,
          guestCohorts:      nextCohorts,
        },
      })
    }
  }
}

console.log(`\nScanned ${scanned} live class(es).`)
if (!drifted.length) {
  console.log('Every seat counter matches its bookings. Nothing to do.')
} else {
  console.log(`${drifted.length} class(es) drifted:\n`)
  for (const d of drifted) {
    console.log(`  ${d.id}  "${String(d.title).slice(0, 46)}"`)
    console.log(`      bookedCount ${d.was} → ${d.actual}${d.pools ? `\n      ${d.pools}` : ''}`)
  }
  console.log(APPLY ? '\nApplied.' : '\nDRY RUN — re-run with --apply to write these.')
}

await mongoose.disconnect()
process.exit(0)
