/* ─────────────────────────────────────────────────────
   "View as student", for the commission portal
   ─────────────────────────────────────────────────────
   A CS — or the Super Admin — opens a student's own LMS from Tetra Commission
   and sees what the student sees (the user, 2026-10-06): the admin's
   client-portal impersonation (admin.controller.ts impersonateClient), started
   from the portal, which says whose student it is.

     POST /service/students/view  { email, byName, byEmail }
       → { url, expiresIn, sessionExpiresAt, from: 'own' | 'shared' }

   The same revocable ImpersonationSession and 60-second single-use handoff
   (redeemed by the student app's /imp/enter), so the session is READ-ONLY
   (auth.middleware.ts denyImpersonatedWrite), lasts IMPERSONATION_EXPIRES_IN,
   is listed and ended on the admin's Impersonation sessions screen, and is
   audited as user.impersonate.client. It is started from the person's own LMS
   staff account, else the shared PORTAL_SUPPORT_USER_EMAIL one
   (portalActivity.service.ts deskAccountFor) — with the person's own address
   as the session's actor email, so the trail and the student app's banner name
   who looked — and stamped with the STUDENT's academy, whose admins can see
   and end it. Only an active student account can be viewed.
───────────────────────────────────────────────────── */
import { randomBytes, createHash } from 'node:crypto'
import { UserModel, ImpersonationSessionModel, ImpersonationHandoffModel, AuditLogModel } from '@/models/schema.ts'
import { PortalError } from '@/services/portal.service.ts'
import { deskAccountFor } from '@/services/portalActivity.service.ts'
import { toSeconds } from '@/utils/jwt.ts'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

/** The code in the link: a bearer secret for this long, then useless (as the admin's handoff). */
const HANDOFF_TTL_MS = 60_000

const bad = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)

function oneEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email must be one address')
  return email
}

export async function studentViewForPortal(input: { email: unknown; byName: unknown; byEmail: unknown; mode?: unknown }) {
  const email = oneEmail(input.email)
  /* "Act as student" (the user, 2026-10-09): read & write — auth.middleware.ts denyImpersonatedWrite lets it change
     things except the account's security, payments and ID documents, and audits each change as the person. The
     portal decides who may ask for it. */
  const mode: 'read' | 'write' = input.mode === 'write' ? 'write' : 'read'
  const student = await UserModel.findOne({ email, role: 'student' }).select('_id name email isActive organizationId').lean() as
    { _id: unknown; name?: string; email: string; isActive?: boolean; organizationId?: unknown } | null
  if (!student) throw new PortalError('NOT_FOUND', 'This student has no account in the LMS', 404)
  if (student.isActive === false) throw new PortalError('ACCOUNT_DISABLED', 'This account is disabled in the LMS and cannot be viewed', 400)

  const by = {
    name: (typeof input.byName === 'string' ? input.byName.trim() : '').slice(0, 100),
    email: (typeof input.byEmail === 'string' ? input.byEmail.trim().toLowerCase() : '').slice(0, 200),
  }
  const account = await deskAccountFor(by.email)
  const actorEmail = by.email || account.email
  const ttl = process.env['IMPERSONATION_EXPIRES_IN']?.trim() || '30m'

  const session = await ImpersonationSessionModel.create({
    actorId: account.id,
    actorEmail,
    targetId: String(student._id),
    targetEmail: student.email,
    organizationId: student.organizationId,
    expiresAt: new Date(Date.now() + toSeconds(ttl) * 1000),
    userAgent: `Tetra Commission — ${by.name || actorEmail}`.slice(0, 300),
    mode,
  })

  // Hashed at rest: the raw code is a bearer secret for its 60 seconds, and a database read should not yield one.
  const code = randomBytes(32).toString('hex')
  await ImpersonationHandoffModel.create({
    codeHash: createHash('sha256').update(code).digest('hex'),
    sessionId: session._id,
    expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
  })

  await AuditLogModel.create({
    actorId: account.id,
    actorEmail,
    actorRole: account.role,
    action: 'user.impersonate.client',
    entity: 'User',
    entityId: String(student._id),
    meta: { via: 'tetra-commission', byName: by.name, byEmail: by.email, from: account.own ? 'own' : 'shared', sessionId: String(session._id), mode },
    userAgent: 'Tetra Commission',
    organizationId: student.organizationId,
  })
  logger.info({ studentId: String(student._id), by, from: account.own ? 'their own account' : 'the shared account' }, '[impersonation] student view started from the commission portal')

  return {
    url: `${env.CLIENT_URL.replace(/\/+$/, '')}/imp/enter?code=${code}`,
    expiresIn: HANDOFF_TTL_MS / 1000,
    sessionExpiresAt: session.expiresAt.toISOString(),
    from: account.own ? 'own' : 'shared',
    mode,
  }
}
