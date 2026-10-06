/* ─────────────────────────────────────────────────────
   Enrolment requests, for the commission portal
   ─────────────────────────────────────────────────────
   The admin's Requests page (admin.controller.ts listEnrollmentRequests,
   approveEnrollment, rejectEnrollment) — somebody signs up and waits to be
   let in — in Tetra Commission too (the user, 2026-10-06): a CS sees and
   decides their own students' requests, the portal naming them by address,
   and a Super Admin every Forex applicant's.

     POST /service/enrolment-requests                   { status, emails?, page?, perPage? }
     POST /service/enrolment-requests/:userId           { email }  one, with the whole application
     POST /service/enrolment-requests/:userId/document  { email, field, byName, byEmail }  a 5-minute link to an ID scan
     POST /service/enrolment-requests/:userId/approve   { email, byName, byEmail }
     POST /service/enrolment-requests/:userId/reject    { email, reason, byName, byEmail }

   Approving lets them in on Forex ('4x-trading'), rejecting turns them away
   with the reason — the same writes, emails and WhatsApp as the admin's
   approve and reject (keep the two in step) — from the deciding CS's own LMS
   staff account, else the shared PORTAL_SUPPORT_USER_EMAIL one, as the
   portal's help-desk answers are (portalActivity.service.ts deskAccountFor).
   Which students somebody may decide is the portal's to say: it names the
   student by address, and a request that is not that address's is "not
   found". Only a waiting request is rejected here: revoking an approved
   student — which deletes their courses — stays in the LMS admin.
───────────────────────────────────────────────────── */
import { Types } from 'mongoose'
import { UserModel, EnrollmentModel, CourseModel, OrganizationModel } from '@/models/schema.ts'
import { PortalError } from '@/services/portal.service.ts'
import { deskAccountFor } from '@/services/portalActivity.service.ts'
import { financeRefusal } from '@/services/financeCustomerCheck.service.ts'
import { sendEnrollmentApproved, sendEnrollmentCancelled } from '@/services/email.service.ts'
import { sendEnrollmentApprovedWhatsApp } from '@/services/whatsapp.service.ts'
import { isR2Configured, keyFromUrl, generatePresignedGetUrl, KYC_PREFIX } from '@/services/r2.service.ts'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

/** The programme the portal lets students in on: Forex. */
const FOREX = '4x-trading'
/** An application that names Forex, as the LMS reads one (utils/departmentScope.ts APPLICATION_PATTERN). */
const FOREX_APPLICATION = /^\s*forex/i
const MAX_EMAILS = 500
const MAX_PER_PAGE = 100
const SIGNED_URL_TTL_SECONDS = 300
const REASON_MIN = 5
const REASON_MAX = 1000

const STATUSES = ['pending', 'approved', 'rejected', 'all'] as const
type Status = (typeof STATUSES)[number]
/** Passport and ID scans, by the name the admin's documents route uses. */
const DOCUMENTS = { passport: 'passportUrl', idDoc: 'idDocUrl' } as const
type DocumentField = keyof typeof DOCUMENTS

const bad = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const notFound = () => new PortalError('NOT_FOUND', 'No such request for this student', 404)
const idOf = (v: unknown) => String(v ?? '')
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : '')

function oneEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email must be one address')
  return email
}

function manyEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw bad('emails must be a list of addresses')
  const wanted = [...new Set(raw.filter((e): e is string => typeof e === 'string').map(e => e.toLowerCase().trim()).filter(Boolean))]
  if (wanted.length > MAX_EMAILS) throw bad(`At most ${MAX_EMAILS} addresses at a time, and ${wanted.length} were asked for`)
  return wanted
}

/* The admin's request pipeline (listEnrollmentRequests): students with a
   request — an express sign-up only once turned away, which is what puts them
   there. */
const IN_PIPELINE: Record<string, unknown> = {
  role: 'student',
  enrollmentStatus: { $exists: true },
  $or: [{ signupType: { $ne: 'express' } }, { enrollmentStatus: { $in: ['rejected', 'cancelled'] } }],
}

/* Every Forex applicant, for a Super Admin: Forex students, and applicants who
   applied to it — as a Forex head sees them (departmentScope.ts applicantClause). */
const FOREX_CLAUSE: Record<string, unknown> = {
  $or: [
    { category: FOREX },
    { categories: FOREX },
    { enrollmentStatus: { $in: ['pending', 'rejected', 'cancelled'] }, 'enrollmentApplication.programs': { $regex: FOREX_APPLICATION } },
  ],
}

const STATUS_CLAUSE: Record<Exclude<Status, 'all'>, Record<string, unknown>> = {
  pending:  { enrollmentStatus: 'pending' },
  approved: { enrollmentStatus: 'approved' },
  rejected: { enrollmentStatus: { $in: ['rejected', 'cancelled'] } },
}

const FIELDS = 'name email enrollmentStatus signupType category categories enrollmentApplication fullRegistrationSubmittedAt createdAt organizationId approvedByName approvedAt rejectedByName rejectedAt rejectionReason enrollmentCancellationReason isActive'

type Application = Record<string, unknown> & { phone?: string; homeCountry?: string; programs?: unknown[]; passportUrl?: string; idDocUrl?: string; photoUrl?: string }
type UserRow = {
  _id: unknown; name?: string; email?: string; enrollmentStatus?: string; signupType?: string
  category?: string; categories?: string[]; enrollmentApplication?: Application
  fullRegistrationSubmittedAt?: Date; createdAt?: Date; organizationId?: unknown
  approvedByName?: string; approvedAt?: Date; rejectedByName?: string; rejectedAt?: Date
  rejectionReason?: string; enrollmentCancellationReason?: string; isActive?: boolean
}

const statusOf = (u: UserRow): Exclude<Status, 'all'> =>
  u.enrollmentStatus === 'approved' ? 'approved' : u.enrollmentStatus === 'pending' ? 'pending' : 'rejected'
const categoriesOf = (u: UserRow): string[] => (u.categories?.length ? u.categories : u.category ? [u.category] : [])

/* What else the student wrote on the form, beside their name and address — the
   ID numbers included, as the admin's request card shows them. Never the scans:
   those are only ever a signed link (requestDocumentForPortal). */
const APPLICATION_FIELDS = [
  'gender', 'dateOfBirth', 'nationality', 'homeCountry', 'occupation', 'idType', 'idNumber', 'emiratesId',
  'countryAttendance', 'villa', 'city', 'addressCountry', 'emergencyContact', 'experienceLevel',
  'preferredStartDate', 'hearAboutUs', 'referralName', 'paymentMethod',
] as const

async function academiesOf(rows: UserRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map(r => idOf(r.organizationId)).filter(id => Types.ObjectId.isValid(id)))]
  if (!ids.length) return new Map()
  const orgs = await OrganizationModel.find({ _id: { $in: ids } }).select('name').lean() as unknown as { _id: unknown; name?: string }[]
  return new Map(orgs.map(o => [idOf(o._id), o.name ?? '']))
}

function requestOf(u: UserRow, academies: Map<string, string>, withApplication = false) {
  const app = u.enrollmentApplication ?? {}
  const status = statusOf(u)
  return {
    id: idOf(u._id),
    name: u.name ?? '',
    email: String(u.email ?? '').toLowerCase(),
    status,
    phone: String(app.phone ?? '').trim(),
    country: String(app.homeCountry ?? '').trim(),
    /** The programmes they applied to, as they picked them. */
    programs: (app.programs ?? []).map(p => String(p)),
    /** The ones they are approved into. */
    categories: categoriesOf(u),
    academy: academies.get(idOf(u.organizationId)) ?? '',
    appliedAt: iso(u.fullRegistrationSubmittedAt ?? u.createdAt),
    signedUpAt: iso(u.createdAt),
    decidedBy: status === 'approved' ? (u.approvedByName ?? '') : status === 'rejected' ? (u.rejectedByName ?? '') : '',
    decidedAt: status === 'approved' ? iso(u.approvedAt) : status === 'rejected' ? iso(u.rejectedAt) : '',
    reason: status === 'rejected' ? (u.rejectionReason ?? u.enrollmentCancellationReason ?? '') : '',
    blocked: u.isActive === false,
    documents: { passport: !!app.passportUrl, idDoc: !!app.idDocUrl, photoUrl: String(app.photoUrl ?? '') },
    ...(withApplication
      ? { application: Object.fromEntries(APPLICATION_FIELDS.map(f => [f, String(app[f] ?? '').trim()]).filter(([, v]) => v)) }
      : {}),
  }
}

/**
 * Requests, newest first: a CS's students' (`emails`, at most 500 at a time —
 * the portal asks in batches) or, with no `emails`, every Forex applicant's.
 */
export async function enrolmentRequestsForPortal(input: { status?: unknown; emails?: unknown; page?: unknown; perPage?: unknown }) {
  const status = (STATUSES as readonly unknown[]).includes(input.status ?? 'pending') ? (input.status ?? 'pending') as Status : null
  if (!status) throw bad(`status must be one of ${STATUSES.join(', ')}`)
  const page = Math.max(1, Math.floor(Number(input.page) || 1))
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(Number(input.perPage) || 50)))
  const emails = input.emails === undefined ? null : manyEmails(input.emails)
  if (emails && !emails.length) return { requests: [], total: 0, page, perPage }

  const filter = {
    $and: [
      IN_PIPELINE,
      ...(status === 'all' ? [] : [STATUS_CLAUSE[status]]),
      emails ? { email: { $in: emails } } : FOREX_CLAUSE,
    ],
  }
  const [rows, total] = await Promise.all([
    UserModel.find(filter).select(FIELDS).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).lean() as unknown as Promise<UserRow[]>,
    UserModel.countDocuments(filter),
  ])
  const academies = await academiesOf(rows)
  return { requests: rows.map(r => requestOf(r, academies)), total, page, perPage }
}

/** The request, if it is this address's — the portal names the student it means. */
async function studentsRequest(userId: unknown, email: unknown, fields = FIELDS): Promise<UserRow> {
  const address = oneEmail(email)
  const id = typeof userId === 'string' ? userId : ''
  const user = Types.ObjectId.isValid(id)
    ? await UserModel.findOne({ _id: id, ...IN_PIPELINE }).select(fields).lean() as unknown as UserRow | null
    : null
  if (!user || String(user.email ?? '').toLowerCase() !== address) throw notFound()
  return user
}

/** One request, with the whole application. */
export async function enrolmentRequestForPortal(input: { userId: unknown; email: unknown }) {
  const user = await studentsRequest(input.userId, input.email)
  return { request: requestOf(user, await academiesOf([user]), true) }
}

/** Who did it, from the portal: their own account is found by the address; the name stands for them on the shared one. */
const actorOf = (byName: unknown, byEmail: unknown) => ({
  name: (typeof byName === 'string' ? byName.trim() : '').slice(0, 100),
  email: (typeof byEmail === 'string' ? byEmail.trim() : '').slice(0, 200),
})

/** Recorded as the approver / rejecter: their own account as itself, else the shared one with their name on it. */
async function deciderFor(byName: unknown, byEmail: unknown) {
  const by = actorOf(byName, byEmail)
  const account = await deskAccountFor(by.email)
  const label = account.own ? (account.name || by.name) : `${by.name || 'Tetra Commission'} (Tetra Commission)`
  return { by, account, name: label, email: account.own ? account.email : (by.email || account.email) }
}

/**
 * A 5-minute link to their passport or ID scan, as the admin's documents route
 * gives one (routes/documents.routes.ts). A legacy scan still at a public
 * address is that address; one kept on local disk cannot be signed, and is for
 * the LMS admin to open.
 */
export async function requestDocumentForPortal(input: { userId: unknown; email: unknown; field: unknown; byName: unknown; byEmail: unknown }) {
  const field = typeof input.field === 'string' && input.field in DOCUMENTS ? input.field as DocumentField : null
  if (!field) throw bad(`field must be one of ${Object.keys(DOCUMENTS).join(', ')}`)
  const user = await studentsRequest(input.userId, input.email, `email enrollmentApplication.${DOCUMENTS[field]}`)
  const stored = String(user.enrollmentApplication?.[DOCUMENTS[field]] ?? '')
  const key = stored ? keyFromUrl(stored) : null
  if (!key) throw new PortalError('NOT_FOUND', 'They have not sent this document', 404)
  const by = actorOf(input.byName, input.byEmail)
  logger.info({ userId: idOf(user._id), field, by }, '[enrolment] identity document opened from the commission portal')
  if (!key.startsWith(KYC_PREFIX)) return { url: stored, expiresIn: null }
  if (!isR2Configured()) throw new PortalError('NOT_AVAILABLE', 'This document is kept where only the LMS admin can open it', 404)
  return { url: await generatePresignedGetUrl(key, SIGNED_URL_TTL_SECONDS), expiresIn: SIGNED_URL_TTL_SECONDS }
}

/**
 * Let them in on Forex, as the admin's approve does: finance asked first while
 * that check is on, the programmes merged, a turned-away account made full
 * again, and the student told by email and WhatsApp. Already in on Forex:
 * nothing changes.
 */
export async function approveEnrolmentForPortal(input: { userId: unknown; email: unknown; byName: unknown; byEmail: unknown }) {
  const user = await studentsRequest(input.userId, input.email)
  const current = categoriesOf(user)
  if (user.enrollmentStatus === 'approved' && current.includes(FOREX)) {
    return { request: requestOf(user, await academiesOf([user])), already: true }
  }
  const email = String(user.email ?? '').toLowerCase()
  const refusal = await financeRefusal(email)
  if (refusal) throw new PortalError(refusal.code, refusal.message, refusal.status)

  const decider = await deciderFor(input.byName, input.byEmail)
  const categories = [...new Set([...current, FOREX])]
  const wasRejected = ['rejected', 'cancelled'].includes(String(user.enrollmentStatus ?? ''))
  await UserModel.findByIdAndUpdate(user._id, {
    $set: {
      enrollmentStatus: 'approved',
      ...(wasRejected && { signupType: 'full' }),
      categories,
      category: categories[0],
      approvedBy: decider.account.id,
      approvedByEmail: decider.email,
      approvedByName: decider.name,
      approvedByRole: decider.account.role,
      approvedAt: new Date(),
    },
    $unset: { enrollmentCancellationReason: '', rejectionReason: '' },
  })
  void sendEnrollmentApproved(email, user.name ?? '', categories.join(', ')).catch(() => {})
  void sendEnrollmentApprovedWhatsApp(user.enrollmentApplication?.phone, user.name ?? '', categories.join(', '), env.CLIENT_URL).catch(() => {})
  logger.info({ userId: idOf(user._id), by: decider.by, from: decider.account.own ? 'their own account' : 'the shared account' }, '[enrolment] approved from the commission portal')

  const fresh = await UserModel.findById(user._id).select(FIELDS).lean() as unknown as UserRow
  return { request: requestOf(fresh, await academiesOf([fresh])), from: decider.account.own ? 'own' : 'shared' }
}

/**
 * Turn a waiting request away, as the admin's reject does: the reason kept and
 * emailed, the account back to express, and any course they were put on
 * already taken off them.
 */
export async function rejectEnrolmentForPortal(input: { userId: unknown; email: unknown; reason: unknown; byName: unknown; byEmail: unknown }) {
  const user = await studentsRequest(input.userId, input.email)
  if (user.enrollmentStatus !== 'pending') {
    throw new PortalError('NOT_PENDING', `Only a waiting request is rejected here — this one is ${statusOf(user)}`, 409)
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) throw bad(`Give a reason of ${REASON_MIN} to ${REASON_MAX} characters`)

  const decider = await deciderFor(input.byName, input.byEmail)
  await UserModel.findByIdAndUpdate(user._id, {
    $set: {
      enrollmentStatus: 'rejected',
      signupType: 'express',
      rejectionReason: reason,
      rejectedBy: decider.account.id,
      rejectedByEmail: decider.email,
      rejectedByName: decider.name,
      rejectedAt: new Date(),
      categories: [],
    },
    $unset: { category: '', approvedBy: '', approvedByEmail: '', approvedByName: '', approvedByRole: '', approvedAt: '' },
  })
  // Read the courses before taking them off, to bring each one's count down.
  const removed = await EnrollmentModel.find({ userId: user._id }, { courseId: 1 }).lean() as unknown as { courseId: unknown }[]
  await EnrollmentModel.deleteMany({ userId: user._id })
  if (removed.length) {
    await CourseModel.bulkWrite(
      removed.map(r => ({ updateOne: { filter: { _id: r.courseId }, update: { $inc: { enrolledCount: -1 } } } })),
      { ordered: false },
    )
  }
  void sendEnrollmentCancelled(String(user.email ?? ''), user.name ?? '', '', reason).catch(() => {})
  logger.info({ userId: idOf(user._id), by: decider.by, from: decider.account.own ? 'their own account' : 'the shared account' }, '[enrolment] rejected from the commission portal')

  const fresh = await UserModel.findById(user._id).select(FIELDS).lean() as unknown as UserRow
  return { request: requestOf(fresh, await academiesOf([fresh])), from: decider.account.own ? 'own' : 'shared' }
}
