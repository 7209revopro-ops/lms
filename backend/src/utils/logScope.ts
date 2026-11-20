/* ─────────────────────────────────────────────────────────────
   Email Logs and WhatsApp Logs for a department's sub admin (2026-11-20)
   ─────────────────────────────────────────────────────────────
   The send logs carry no course, only who a message went to. A sub admin sees
   the messages sent to the students of their department: enrolled (not dropped)
   in one of its courses (departmentScope.ts — course.program), in their own
   academy. E-mail by address; WhatsApp by the number as the outbox stores it
   (normalizeWhatsAppNumber — digits only). Never a mentor's or staff member's
   mail. A student in two departments' courses shows in both — the log cannot
   tell which course a message was about.

   super_admin: everything, as before (null). A sub admin with no department:
   nothing (empty lists) — fail closed, like every department rule.
───────────────────────────────────────────────────────────── */
import type { Request } from 'express'
import { Types } from 'mongoose'
import { callerDepartment, departmentCourseIds, NO_DEPARTMENT } from '@/utils/departmentScope.ts'
import { callerOrgForRead } from '@/utils/tenancy.ts'
import { normalizeWhatsAppNumber } from '@/utils/normalizeWhatsAppNumber.ts'

export interface LogRecipients { emails: string[]; phones: string[] }
const MEMO = Symbol('logRecipients')

export async function logRecipientScope(req: Request): Promise<LogRecipients | null> {
  if (req.user?.role === 'super_admin') return null
  const memo = (req as Request & { [MEMO]?: LogRecipients })[MEMO]
  if (memo) return memo
  const none: LogRecipients = { emails: [], phones: [] }
  const d = callerDepartment(req)
  if (d === null || d === NO_DEPARTMENT) return keep(req, none)
  const courseIds = await departmentCourseIds(req)
  if (!courseIds?.length) return keep(req, none)

  const caller = await callerOrgForRead(req)
  if (caller.gone) return keep(req, none)
  const org = caller.org
  const { EnrollmentModel, UserModel } = await import('@/models/schema.ts')
  const userIds = await EnrollmentModel.distinct('userId', { courseId: { $in: courseIds }, status: { $ne: 'dropped' } }) as Types.ObjectId[]
  const users = await UserModel.find({
    _id: { $in: userIds }, role: 'student',
    ...(org && Types.ObjectId.isValid(String(org)) ? { organizationId: new Types.ObjectId(String(org)) } : {}),
  }).select('email enrollmentApplication.phone phone').lean() as Array<{ email?: string; phone?: string; enrollmentApplication?: { phone?: string } }>

  const emails = new Set<string>(), phones = new Set<string>()
  for (const u of users) {
    if (u.email) { emails.add(u.email.trim()); emails.add(u.email.trim().toLowerCase()) }
    for (const raw of [u.enrollmentApplication?.phone, u.phone]) {
      const n = normalizeWhatsAppNumber(raw ?? null)
      if (n) phones.add(n)
    }
  }
  return keep(req, { emails: [...emails], phones: [...phones] })
}

function keep(req: Request, r: LogRecipients): LogRecipients {
  (req as Request & { [MEMO]?: LogRecipients })[MEMO] = r
  return r
}
