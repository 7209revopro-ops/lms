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
   is how a seat gets handed out twice.

   Returns whether the move landed, like every other helper here. It used to
   return void, which made it the one guarded write in this file whose refusal
   nobody could see: a negative delta that lost the race below wrote nothing and
   the caller applied the new capacity anyway, leaving the room's seats and its
   capacity disagreeing with no error and no trace. */
export async function adjustOverflow(liveClassId: string, delta: number): Promise<boolean> {
  if (!delta) return true
  const { LiveClassModel } = await import('@/models/schema.ts')
  /* The floor guard belongs in the FILTER. A negative delta large enough to
     take the pool below zero must not apply at all, and a read-then-check
     loses to a booking that lands in between — which is the whole reason
     every other helper here puts its guard in the query. */
  const r = await LiveClassModel.updateOne(
    {
      _id: new Types.ObjectId(liveClassId),
      overflowSeatsLeft: delta < 0 ? { $gte: -delta } : { $exists: true },
    },
    { $inc: { overflowSeatsLeft: delta } },
  )
  return r.modifiedCount > 0
}

/* First-time allocation of a class that already exists.

   create() computes the same thing, but it may assume bookedCount is 0. Here
   it is not: seats already taken are spent and cannot be promised to anybody,
   so the caller subtracts them and passes the host floor in.

   The bookedCount compare-and-set is the point of doing it here. The
   UNALLOCATED reserve path increments bookedCount with no counter to
   compensate, so a booking landing between the caller's read and this write
   makes the arithmetic wrong by exactly one seat — oversold, silently, with
   the invariant broken from birth. Refusing and letting the caller retry is
   the only honest answer. */
export async function allocatePools(
  liveClassId: string,
  pools: {
    bookedCount: number
    hostSeatsLeft: number
    overflowSeatsLeft: number
    guestCohorts: Array<{ organizationId: string; courseId: string; sectionId?: string; seatFloor: number }>
  },
): Promise<boolean> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const r = await LiveClassModel.updateOne(
    {
      _id: new Types.ObjectId(liveClassId),
      bookedCount: pools.bookedCount,
      hostSeatsLeft: { $exists: false },
    },
    { $set: {
      hostSeatsLeft:     pools.hostSeatsLeft,
      overflowSeatsLeft: pools.overflowSeatsLeft,
      guestCohorts:      pools.guestCohorts.map(c => ({
        organizationId: new Types.ObjectId(c.organizationId),
        courseId:       new Types.ObjectId(c.courseId),
        ...(c.sectionId ? { sectionId: new Types.ObjectId(c.sectionId) } : {}),
        seatFloor: Math.max(0, Math.trunc(c.seatFloor)),
        seatsLeft: Math.max(0, Math.trunc(c.seatFloor)),
      })),
    } },
  )
  return r.modifiedCount > 0
}

/* ─────────────────────────────────────────────────────
   Editing an academy's floor after the class exists

   THE HOUSE RULE, copied from the capacity edit above: a change lands in the
   OVERFLOW, never in somebody else's floor. A floor is what an academy was
   promised, and quietly enlarging or shrinking one is the same surprise.

   Let d = F' - F for the cohort being edited. Then

       seatsLeft      += d
       overflowSeatsLeft -= d
       seatFloor       = F'

   and the invariant survives, because the two counters move by equal and
   opposite amounts and bookedCount is untouched.

   EVERY GUARD IS IN THE FILTER, none is a read-then-check. A read-then-check
   loses to a booking that lands in between, which is the whole reason the
   counters count down.

     · seatsLeft >= max(0, -d)   is algebraically F' >= held, so a floor can
       never be cut below the seats that cohort is already sitting in. At the
       boundary F' === held it passes and leaves seatsLeft 0, which is right.
     · overflowSeatsLeft >= max(0, d) makes the donor prove it has the seats
       before they are moved.
     · seatFloor === F is a COMPARE-AND-SET, and it is not optional. Without
       it two identical requests — a double-clicked Save, a retry — each
       compute d from the same read and BOTH apply. The sum still equals
       sessionCapacity so nothing detects it, the schema's sum check does not
       run on findByIdAndUpdate, and the reconciler later "repairs" the
       inflated seatsLeft back down, destroying seats that were never taken.
       It also gives "an unchanged floor writes nothing" for free.
───────────────────────────────────────────────────── */
export async function setGuestFloor(
  liveClassId: string,
  orgId:       string,
  currentFloor: number,
  nextFloor:    number,
): Promise<boolean> {
  const d = nextFloor - currentFloor
  if (d === 0) return true
  const { LiveClassModel } = await import('@/models/schema.ts')
  const _id = new Types.ObjectId(liveClassId)
  const org = new Types.ObjectId(orgId)

  const r = await LiveClassModel.updateOne(
    {
      _id,
      overflowSeatsLeft: { $gte: Math.max(0, d) },
      guestCohorts: { $elemMatch: {
        organizationId: org,
        seatFloor:      currentFloor,          // compare-and-set
        seatsLeft:      { $gte: Math.max(0, -d) },
      } },
    },
    {
      $inc: { 'guestCohorts.$[c].seatsLeft': d, overflowSeatsLeft: -d },
      $set: { 'guestCohorts.$[c].seatFloor': nextFloor },
    },
    { arrayFilters: [{ 'c.organizationId': org, 'c.seatFloor': currentFloor }] },
  )
  return r.modifiedCount > 0
}

/** Add an academy to a class that is ALREADY allocated. The seats come out of
    the overflow, which must be able to cover them. */
export async function addGuestCohort(
  liveClassId: string,
  cohort: { organizationId: string; courseId: string; sectionId?: string; seatFloor: number },
): Promise<boolean> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const floor = Math.max(0, Math.trunc(cohort.seatFloor))
  const org   = new Types.ObjectId(cohort.organizationId)

  const r = await LiveClassModel.updateOne(
    {
      _id: new Types.ObjectId(liveClassId),
      overflowSeatsLeft: { $gte: floor },
      'guestCohorts.organizationId': { $ne: org },   // an academy appears once
    },
    {
      $inc:  { overflowSeatsLeft: -floor },
      $push: { guestCohorts: {
        organizationId: org,
        courseId:       new Types.ObjectId(cohort.courseId),
        ...(cohort.sectionId ? { sectionId: new Types.ObjectId(cohort.sectionId) } : {}),
        seatFloor: floor,
        seatsLeft: floor,
      } },
    },
  )
  return r.modifiedCount > 0
}

/** Re-aim an existing cohort's DOOR without touching its seats.

    The diff used to key a cohort on organizationId alone, so changing which of
    that academy's courses (or modules) the class admits through was accepted
    with 200 and then written nowhere: the patch path deletes guestCohorts
    before it runs, and no seat helper carried the two fields. The form said
    saved, the door never moved, and the only way to notice was to reopen the
    class.

    Seats deliberately do not move. A door is WHICH students may come in; the
    floor is HOW MANY. Re-aiming the door at another module of the same academy
    changes who qualifies, not how many seats that academy was promised — and
    anyone already booked keeps the seat they hold, which is the same answer
    releaseSeat gives for a cohort that disappears. */
export async function repointGuestCohort(
  liveClassId: string,
  orgId:       string,
  door:        { courseId: string; sectionId?: string },
): Promise<boolean> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const org = new Types.ObjectId(orgId)
  const r = await LiveClassModel.updateOne(
    { _id: new Types.ObjectId(liveClassId), 'guestCohorts.organizationId': org },
    {
      $set: {
        'guestCohorts.$[c].courseId': new Types.ObjectId(door.courseId),
        ...(door.sectionId
          ? { 'guestCohorts.$[c].sectionId': new Types.ObjectId(door.sectionId) }
          : {}),
      },
      /* An ungated door is the ABSENCE of a module, not an empty one — a
         stored null would fail the "every guest names a module" check that the
         host-gated rule relies on. */
      ...(door.sectionId ? {} : { $unset: { 'guestCohorts.$[c].sectionId': '' } }),
    },
    { arrayFilters: [{ 'c.organizationId': org }] },
  )
  return r.modifiedCount > 0 || r.matchedCount > 0
}

/** Remove an academy. ONLY when it is holding nothing.

    Removing a cohort whose students have booked strands them: doorsFor()
    rebuilds the doors from this array, so their join answers WRONG_ACADEMY
    while their booking row still reads 'booked'. Refusing follows the nearest
    precedent in this codebase — CAPACITY_BELOW_BOOKED refuses rather than
    reconciles — and reconciling would be a cancellation-and-refund feature,
    not a seat move. The filter demands seatsLeft === seatFloor, which is
    exactly "this academy has drawn nothing". */
export async function removeGuestCohort(
  liveClassId: string,
  orgId:       string,
  floor:       number,
): Promise<boolean> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const org = new Types.ObjectId(orgId)
  const r = await LiveClassModel.updateOne(
    {
      _id: new Types.ObjectId(liveClassId),
      guestCohorts: { $elemMatch: { organizationId: org, seatFloor: floor, seatsLeft: floor } },
    },
    {
      $inc:  { overflowSeatsLeft: floor },
      $pull: { guestCohorts: { organizationId: org } },
    },
  )
  return r.modifiedCount > 0
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
