/* ─────────────────────────────────────────────────────
   The records that must go when a user account goes.

   There were two delete paths and only one of them cleaned up. A student who
   deleted their OWN account released their enrolments, reviews and progress
   (auth.service.deleteAccount). A student deleted by an ADMIN
   (user.service.adminDelete) left all of it behind — the user row went, and
   every enrolment pointing at it stayed.

   Those rows outlive the account they name, and the admin course table counts
   enrolments: locally 27 of 56 belonged to accounts that no longer existed,
   which is how a course could report 7 students while the roster could only
   name 1. The roster surfaces them as `orphaned` rather than hiding the gap,
   but the honest fix is not to create them.

   One function, called by both paths, so they cannot drift apart again.
───────────────────────────────────────────────────── */
import type { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'

/* Deletes the personal records attached to a user and repairs the counters
   those records were feeding. Does NOT delete the user document itself — the
   caller owns that, because the two callers differ on what else they do
   around it (a password re-auth on one side, a tenancy check on the other).

   Safe to call for a user with nothing attached, and safe to call twice. */
export async function cascadeUserDeletion(userId: string | Types.ObjectId): Promise<void> {
  /* Imported lazily: schema.ts pulls in the services in some paths, and a
     top-level import here closes a cycle at module load. */
  const {
    ReviewModel, EnrollmentModel, LessonProgressModel, AuthTokenModel,
    CourseModel, DeviceModel, ClassBookingModel,
  } = await import('@/models/schema.ts')
  const { releaseSeat } = await import('@/services/seatPool.service.ts')

  /* Read the courses before the rows go — afterwards there is nothing left to
     tell us which counters to decrement. */
  const removedEnrolments = await EnrollmentModel.find({ userId }, { courseId: 1 }).lean()

  /* CLASS BOOKINGS WERE NOT CASCADED AT ALL, and the seat was never returned.
     A deleted student permanently consumed one seat of every class they had
     booked: the row stayed, bookedCount stayed, and the class quietly had one
     fewer seat forever with nothing to reconcile it against.

     That was already wrong. Once a class divides its seats into per-academy
     floors it gets worse, because the seat is not lost from the room in
     general — it is lost from one ACADEMY's floor, so an academy silently
     stops getting the seats it was promised.

     Only live seats are released. A cancelled booking already gave its seat
     back, and releasing it again would credit the pool twice. */
  const heldSeats = await ClassBookingModel.find(
    { userId, status: { $in: ['booked', 'attended'] } },
    { liveClassId: 1, seatPoolKind: 1, seatOrganizationId: 1 },
  ).lean()

  await Promise.all([
    AuthTokenModel.deleteMany({ userId }).exec(),
    ReviewModel.deleteMany({ userId }).exec(),
    EnrollmentModel.deleteMany({ userId }).exec(),
    LessonProgressModel.deleteMany({ userId }).exec(),
    /* A device whitelist entry for an account that no longer exists is a row
       in the admin approvals list that can never be actioned. */
    DeviceModel.deleteMany({ userId }).exec(),
    ClassBookingModel.deleteMany({ userId }).exec(),
  ])

  /* Sequential, not Promise.all: two seats on the SAME class would otherwise
     race each other's read-modify-write of the pool counters. A deleted user
     holds a handful of seats at most, so the cost is irrelevant and the
     correctness is not. */
  for (const seat of heldSeats) {
    await releaseSeat(seat as never)
  }

  if (removedEnrolments.length) {
    await CourseModel.bulkWrite(
      removedEnrolments.map(r => ({
        updateOne: { filter: { _id: r.courseId }, update: { $inc: { enrolledCount: -1 } } },
      })),
      { ordered: false },
    )
  }

  logger.info(
    {
      userId:             String(userId),
      enrolmentsReleased: removedEnrolments.length,
      seatsReleased:      heldSeats.length,
    },
    'user records cascaded',
  )
}
