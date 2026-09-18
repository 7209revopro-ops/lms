/* ─────────────────────────────────────────────────────
   seatPool — the only code allowed to move a live class's seat counter

   A class has ONE room and, once it serves more than one academy, more than one
   claim on it. Each academy is promised a FLOOR of seats nobody else may take,
   and whatever is left over is a COMMON OVERFLOW either academy may draw from.

   Without a floor the first academy to open its booking page takes the room,
   and the other academy's students are told a class their admin scheduled them
   into is full. Without an overflow, seats stand empty while somebody is
   refused. The pair is the compromise; neither alone is one.

   COUNTERS COUNT DOWN, AND THAT IS THE TRICK.
   `seatsLeft` is remaining seats, not seats taken. A countdown compares against
   a LITERAL — `{ $gt: 0 }` — and a literal comparison is legal inside
   `$elemMatch`, where `$expr` is not. So the per-cohort condition fits in the
   query filter and the whole reservation stays ONE atomic updateOne against ONE
   document. Count upwards instead and the condition becomes "this element's
   taken < this element's floor", which needs `$expr` over `$let`/`$filter`
   inside the hottest write on the booking path. That predicate was written, and
   rejected: nobody reviews it confidently, and an unreviewable predicate
   guarding seat accounting is a liability, not a neutral cost.

   THE INVARIANT:
     hostSeatsLeft + Σ guestCohorts[].seatsLeft + overflowSeatsLeft + bookedCount
       === sessionCapacity

   BACK-COMPAT IS THE DEFAULT PATH. `hostSeatsLeft === undefined` means NO
   ALLOCATION IN FORCE, which is every class that existed before this feature.
   The helper then runs the original single-statement reservation, byte for
   byte. The allocation path only ever executes for a class an admin
   deliberately gave cohorts. That is why this needs no migration.

   THE `$expr` CAPACITY CAP STAYS IN EVERY FILTER, including the allocated
   paths, as the global backstop. Even a corrupted allocation cannot oversell
   the room.

   THIS FILE MUST BE THE ONLY WAY TO TOUCH `bookedCount`. There are twelve
   reserve and release sites; miss one and a seat leaks out of an academy's
   floor with nothing to reconcile it. `bun run check:seats` fails the build on
   any raw `$inc: { bookedCount` outside this file.
───────────────────────────────────────────────────── */

import { Types } from 'mongoose'

/** Which pool a seat was drawn from. Stamped on the booking so the release
    returns it to the same place — see releaseSeat. */
export type SeatPool =
  | { kind: 'flat' }                            // no allocation in force
  | { kind: 'host' }
  | { kind: 'guest'; organizationId: string }
  | { kind: 'overflow' }

export interface ReservedSeat {
  pool: SeatPool
}

/* ─────────────────────────────────────────────────────
   Reserve
───────────────────────────────────────────────────── */
export async function reserveSeat(
  liveClassId: string,
  /** The academy whose door the student came through, from the entitlement
      resolver. null means "the host", which is every class today. */
  doorOrgId:   string | null,
): Promise<ReservedSeat | null> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const _id = new Types.ObjectId(liveClassId)

  const live = await LiveClassModel.findById(_id)
    .select('organizationId hostSeatsLeft guestCohorts').lean()
  if (!live) return null

  const allocated = typeof (live as { hostSeatsLeft?: unknown }).hostSeatsLeft === 'number'

  /* ── No allocation: today's exact statement, unchanged ── */
  if (!allocated) {
    const r = await LiveClassModel.updateOne(
      { _id, $expr: { $lt: ['$bookedCount', '$sessionCapacity'] } },
      { $inc: { bookedCount: 1 } },
    )
    return r.modifiedCount === 0 ? null : { pool: { kind: 'flat' } }
  }

  const ownOrg = (live as { organizationId?: unknown }).organizationId
  const isHost = !doorOrgId || (ownOrg != null && String(ownOrg) === String(doorOrgId))

  /* ── The student's own academy's floor ── */
  if (isHost) {
    const r = await LiveClassModel.updateOne(
      { _id, hostSeatsLeft: { $gt: 0 }, $expr: { $lt: ['$bookedCount', '$sessionCapacity'] } },
      { $inc: { bookedCount: 1, hostSeatsLeft: -1 } },
    )
    if (r.modifiedCount > 0) return { pool: { kind: 'host' } }
  } else {
    const orgId = new Types.ObjectId(doorOrgId)
    const r = await LiveClassModel.updateOne(
      {
        _id,
        guestCohorts: { $elemMatch: { organizationId: orgId, seatsLeft: { $gt: 0 } } },
        $expr: { $lt: ['$bookedCount', '$sessionCapacity'] },
      },
      { $inc: { bookedCount: 1, 'guestCohorts.$[c].seatsLeft': -1 } },
      { arrayFilters: [{ 'c.organizationId': orgId }] },
    )
    if (r.modifiedCount > 0) return { pool: { kind: 'guest', organizationId: String(doorOrgId) } }
  }

  /* ── Their floor is exhausted: fall back to the common overflow ──
     Two attempts at most, each atomic on its own. A failed CAS writes nothing,
     so there is no torn intermediate state and no transaction is needed. */
  const r = await LiveClassModel.updateOne(
    { _id, overflowSeatsLeft: { $gt: 0 }, $expr: { $lt: ['$bookedCount', '$sessionCapacity'] } },
    { $inc: { bookedCount: 1, overflowSeatsLeft: -1 } },
  )
  return r.modifiedCount === 0 ? null : { pool: { kind: 'overflow' } }
}

/* ─────────────────────────────────────────────────────
   Release

   THE POOL IS READ FROM THE BOOKING, NEVER RE-DERIVED. A student's entitlement
   can change between booking and cancelling — an admin moves them, revokes a
   module, un-shares the class — and a re-derived door returns the seat to the
   wrong academy's floor. The stamp on the booking row is the record of where
   the seat came from, and it is the only trustworthy answer.
───────────────────────────────────────────────────── */
export async function releaseSeat(booking: {
  liveClassId:         unknown
  seatOrganizationId?: unknown
  seatPoolKind?:       string
}): Promise<void> {
  const { LiveClassModel } = await import('@/models/schema.ts')

  /* THE ID MAY ARRIVE POPULATED, AND THIS GUARD USED TO SWALLOW IT.

     The student cancel route loads its booking with
     .populate('liveClassId', ...).lean(), so `booking.liveClassId` is a plain
     object rather than an ObjectId. String({...}) is "[object Object]",
     isValid said no, and this function returned having done NOTHING — while
     the route answered 200 and flipped the row to cancelled. Every student
     self-cancel burned a seat permanently, on every class, with the feature
     off and nothing anywhere reporting a problem.

     The statement this replaced was a raw updateOne whose filter Mongoose
     CAST for us, and the caster extracts _id from a populated document. So the
     helper was stricter than the code it replaced, and that difference was the
     entire bug.

     Two changes. Accept the shapes that actually arrive, and REFUSE LOUDLY on
     one that does not: a seat helper that silently no-ops is indistinguishable
     from a seat helper that worked, which is why this survived a green suite,
     a green full chain and a lint that greps for raw $inc. */
  const raw = booking.liveClassId as { _id?: unknown } | string | null | undefined
  const id = raw && typeof raw === 'object' && '_id' in raw ? (raw as { _id?: unknown })._id : raw
  if (!id || !Types.ObjectId.isValid(String(id))) {
    const { logger } = await import('@/utils/logger.ts')
    logger.error({ liveClassId: booking.liveClassId }, 'releaseSeat: unusable liveClassId — SEAT NOT RELEASED')
    return
  }
  const _id = new Types.ObjectId(String(id))

  const live = await LiveClassModel.findById(_id)
    .select('organizationId hostSeatsLeft guestCohorts').lean()
  if (!live) return

  const allocated = typeof (live as { hostSeatsLeft?: unknown }).hostSeatsLeft === 'number'

  /* No allocation: today's exact statement, unchanged. Also the correct answer
     for a booking taken BEFORE an admin added cohorts to the class — it carries
     no stamp, so there is no floor to return it to. */
  if (!allocated) {
    await LiveClassModel.updateOne({ _id, bookedCount: { $gt: 0 } }, { $inc: { bookedCount: -1 } })
    return
  }

  const kind = booking.seatPoolKind
  const seatOrg = booking.seatOrganizationId

  if (kind === 'overflow') {
    await LiveClassModel.updateOne(
      { _id, bookedCount: { $gt: 0 } },
      { $inc: { bookedCount: -1, overflowSeatsLeft: 1 } },
    )
    return
  }

  if (kind === 'guest' && seatOrg) {
    const orgId = new Types.ObjectId(String(seatOrg))
    const r = await LiveClassModel.updateOne(
      { _id, bookedCount: { $gt: 0 }, 'guestCohorts.organizationId': orgId },
      { $inc: { bookedCount: -1, 'guestCohorts.$[c].seatsLeft': 1 } },
      { arrayFilters: [{ 'c.organizationId': orgId }] },
    )
    /* The cohort was removed while the seat was held. The seat still has to
       come back or the room shrinks permanently, so it goes to the overflow —
       the pool that belongs to nobody in particular. */
    if (r.modifiedCount === 0) {
      await LiveClassModel.updateOne(
        { _id, bookedCount: { $gt: 0 } },
        { $inc: { bookedCount: -1, overflowSeatsLeft: 1 } },
      )
    }
    return
  }

  /* 'host', or an unstamped booking on a class that has since been allocated.
     Both belong to the host's floor: the unstamped one was taken before any
     cohort existed, which means it was the host's. */
  await LiveClassModel.updateOne(
    { _id, bookedCount: { $gt: 0 } },
    { $inc: { bookedCount: -1, hostSeatsLeft: 1 } },
  )
}

/* Move the overflow pool by a RELATIVE amount, for a capacity edit.

   The caller has just changed sessionCapacity, and the difference has to land
   somewhere. It lands in the overflow rather than in anybody's floor, because a
   floor is what an academy was promised and quietly enlarging one is as
   surprising as quietly shrinking it.

   Relative, so a booking that decrements the same counter between the caller's
   read and this write is not lost. An absolute $set computed from a stale read
   is how a seat gets handed out twice. */
export async function adjustOverflow(liveClassId: string, delta: number): Promise<void> {
  if (!delta) return
  const { LiveClassModel } = await import('@/models/schema.ts')
  await LiveClassModel.updateOne(
    { _id: new Types.ObjectId(liveClassId), overflowSeatsLeft: { $exists: true } },
    { $inc: { overflowSeatsLeft: delta } },
  )
}

/* The three fields a booking is stamped with, from a reservation. Kept here so
   the four booking paths cannot disagree about the shape. */
export function seatStampFrom(
  reserved: ReservedSeat,
  door:     { organizationId?: string | null; courseId?: string | null; sectionId?: string | null } | undefined,
): Record<string, unknown> {
  const stamp: Record<string, unknown> = { seatPoolKind: reserved.pool.kind }
  if (reserved.pool.kind === 'guest') {
    stamp['seatOrganizationId'] = new Types.ObjectId(reserved.pool.organizationId)
  } else if (door?.organizationId && Types.ObjectId.isValid(door.organizationId)) {
    stamp['seatOrganizationId'] = new Types.ObjectId(door.organizationId)
  }
  if (door?.courseId && Types.ObjectId.isValid(door.courseId)) {
    stamp['seatCourseId'] = new Types.ObjectId(door.courseId)
  }
  if (door?.sectionId && Types.ObjectId.isValid(door.sectionId)) {
    stamp['seatSectionId'] = new Types.ObjectId(door.sectionId)
  }
  return stamp
}
