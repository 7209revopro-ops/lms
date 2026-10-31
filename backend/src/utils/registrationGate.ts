/* ─────────────────────────────────────────────────────────────
   Registration gate (2026-10-31)

   A buyer from /explore pays first and fills the full registration form after
   (guestCheckout.service marks `registrationDue`). Until that form is in they
   may sign in, browse, and see the course they bought and its class schedule —
   but booking a class, joining one, and opening lessons wait for the form.
   Submitting it (AuthService.completeRegistration) clears the flag and
   approves them as Paid Enrollment.

   Only the flag decides: a student without it is never held here, whatever
   their enrollmentStatus — the rule is for /explore buyers, not for existing
   students who never filled the form (the user's choice).
───────────────────────────────────────────────────────────── */
import { Types } from 'mongoose'

export const REGISTRATION_REQUIRED = 'REGISTRATION_REQUIRED'
export const REGISTRATION_REQUIRED_MESSAGE =
  'Complete your registration to book and join classes and open your lessons — it takes a few minutes.'

/** True when this student still owes the registration form. Staff never do. */
export async function registrationOutstanding(userId: string | undefined | null): Promise<boolean> {
  if (!userId || !Types.ObjectId.isValid(userId)) return false
  const { UserModel } = await import('@/models/schema.ts')
  return !!(await UserModel.exists({ _id: userId, role: 'student', registrationDue: true }))
}
