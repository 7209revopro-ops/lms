import { Types } from 'mongoose'
import { EnrollmentModel, SectionModel, type PaymentAccessStatus } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'

/* ────────────────────────────────────────────────────────────────────────────
   Which modules an enrolment opens, by how much of the fee is paid.

   Only for enrolments finance created and gave a payment status. The rule is
   fixed, as the business set it:
     paid     every module
     partial  the first half of the modules, in course order, rounded up
     unpaid   none, until a payment is recorded

   It works through Enrollment.blockedLessons — which, despite the name, holds
   SECTION (module) ids — so every place that already refuses a locked module
   (lesson playback, live-class booking and joining, the student's course
   page) enforces it without being touched.

   It only ever opens. A later payment unlocks more; nothing here re-locks a
   module somebody could already open, whatever happens to the payment. The one
   thing it locks after the first time is a module added to the course later,
   which a part-payer would otherwise find open by accident.
──────────────────────────────────────────────────────────────────────────── */

const RANK: Record<PaymentAccessStatus, number> = { unpaid: 0, partial: 1, paid: 2 }

export function openModuleCount(status: PaymentAccessStatus, total: number): number {
  if (status === 'paid') return total
  if (status === 'partial') return Math.ceil(total / 2)
  return 0
}

/* Course order as the student sees it; creation time breaks ties so two
   modules left at the same position still come out the same way every time. */
async function orderedModuleIds(courseId: Types.ObjectId | string): Promise<string[]> {
  const rows = await SectionModel.find({ courseId })
    .sort({ order: 1, createdAt: 1, _id: 1 })
    .select('_id')
    .lean()
  return rows.map(r => String(r._id))
}

const oids = (ids: string[]) => ids.map(id => new Types.ObjectId(id))

export interface AccessSummary {
  status:       PaymentAccessStatus
  totalModules: number
  openModules:  number
  changed:      boolean
}

/* The first time: an enrolment finance has just created. Everything past what
   the status opens is locked. */
export async function applyInitialPaymentAccess(
  enrollmentId: Types.ObjectId | string,
  courseId: Types.ObjectId | string,
  status: PaymentAccessStatus,
  invoiceId: string,
): Promise<AccessSummary> {
  const ids = await orderedModuleIds(courseId)
  const open = openModuleCount(status, ids.length)
  const locked = ids.slice(open)
  await EnrollmentModel.updateOne(
    { _id: enrollmentId },
    {
      $set: { paymentAccess: { status, invoiceId, updatedAt: new Date() } },
      ...(locked.length ? { $addToSet: { blockedLessons: { $each: oids(locked) } } } : {}),
    },
  ).exec()
  return { status, totalModules: ids.length, openModules: open, changed: true }
}

/* A later payment. Moves up only — partial after paid, or unpaid after
   partial, changes nothing. Paid opens every module, including any an admin
   had locked by hand: the student has paid for the whole course. */
export async function raisePaymentAccess(
  enrollmentId: Types.ObjectId | string,
  status: PaymentAccessStatus,
): Promise<AccessSummary | null> {
  const enrollment = await EnrollmentModel.findById(enrollmentId)
    .select('courseId paymentAccess blockedLessons').lean()
  if (!enrollment) return null
  const current = enrollment.paymentAccess?.status
  const ids = await orderedModuleIds(enrollment.courseId)

  // Not an enrolment this rule governs: left exactly as it is.
  if (!current) {
    return { status, totalModules: ids.length, openModules: ids.length - (enrollment.blockedLessons?.length ?? 0), changed: false }
  }
  if (RANK[status] <= RANK[current]) {
    return { status: current, totalModules: ids.length, openModules: openModuleCount(current, ids.length), changed: false }
  }

  const open = openModuleCount(status, ids.length)
  await EnrollmentModel.updateOne(
    { _id: enrollmentId },
    status === 'paid'
      ? { $set: { blockedLessons: [], 'paymentAccess.status': status, 'paymentAccess.updatedAt': new Date() } }
      : {
          $set:  { 'paymentAccess.status': status, 'paymentAccess.updatedAt': new Date() },
          $pull: { blockedLessons: { $in: oids(ids.slice(0, open)) } },
        },
  ).exec()
  return { status, totalModules: ids.length, openModules: open, changed: true }
}

/* A module was added to a course. Every part-paid enrolment keeps "half": the
   new module is locked when it falls past the half, and when the half grows
   by one — 10 modules to 11 — the module that now falls inside it opens. */
export async function onModuleAdded(courseId: Types.ObjectId | string, moduleId: Types.ObjectId | string): Promise<number> {
  const governed = await EnrollmentModel.find({ courseId, 'paymentAccess.status': { $in: ['partial', 'unpaid'] } })
    .select('_id paymentAccess').lean()
  if (!governed.length) return 0

  const ids = await orderedModuleIds(courseId)
  const added = String(moduleId)
  let touched = 0
  for (const e of governed) {
    const status = e.paymentAccess!.status as PaymentAccessStatus
    const before = openModuleCount(status, ids.length - 1)
    const after  = openModuleCount(status, ids.length)
    const openNow = new Set(ids.slice(0, after))
    const newlyOpen = ids.slice(0, after).filter((id, i) => i >= before && id !== added)

    if (!openNow.has(added)) {
      await EnrollmentModel.updateOne({ _id: e._id }, { $addToSet: { blockedLessons: new Types.ObjectId(added) } }).exec()
    }
    if (newlyOpen.length) {
      await EnrollmentModel.updateOne({ _id: e._id }, { $pull: { blockedLessons: { $in: oids(newlyOpen) } } }).exec()
    }
    touched++
  }
  logger.info({ courseId: String(courseId), moduleId: added, enrolments: touched }, 'New module: part-paid enrolments kept to their half')
  return touched
}
