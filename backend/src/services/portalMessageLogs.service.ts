import { createHash } from 'node:crypto'
import { PortalError } from '@/services/portal.service.ts'
import { deskAccountFor } from '@/services/portalActivity.service.ts'
import { LINK_MAX_SIGNINS } from '@/services/auth.service.ts'
import { createdBetween, type StatusCounts } from '@/utils/outboxLog.ts'
import { renderWhatsApp, WHATSAPP_TEMPLATES } from '@/utils/whatsappTemplates.ts'
import { zoneDateKey, zoneDayBounds, addDaysToDateKey } from '@/utils/zoneDay.ts'

/* ─────────────────────────────────────────────────────────────
   Message logs for the CS Portal (the user, 2026-10-29): the email queue
   (EmailOutbox) and the WhatsApp send log (WhatsAppOutbox) as the admin's
   Email Logs / WhatsApp Logs pages show them — but only the messages to
   the students the portal names (their addresses and phones; a student's
   phones on their LMS account count too), or every one when it says `all`.
   The portal decides who may see whose. Read only.

   `reveal`: a one-tap button's real link (join /j/, sign-in /s/) with
   where it stands, as the super admin's WhatsApp Logs — the portal asks
   for it only for people who may act as that student anyway.

   And a student's one-time login link (Students → Login link, made from
   the portal): signs them in once within 24 hours, from the CS's own LMS
   account, else the shared one (deskAccountFor). Audited.
───────────────────────────────────────────────────────────── */

const bad = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const ZONE = 'Asia/Dubai'
const MAX_PEOPLE = 50_000
const MAX_LIMIT = 500
const STATUSES = ['pending', 'sent', 'failed']

const emailsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((e): e is string => typeof e === 'string').map(e => e.trim().toLowerCase()).filter(e => e.includes('@')))].slice(0, MAX_PEOPLE) : []
/** The last 9 digits of each phone: a number written with or without its country code / 0. */
const tailsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.map(p => String(p ?? '').replace(/\D/g, '')).filter(d => d.length >= 7).map(d => d.slice(-9)))].slice(0, MAX_PEOPLE) : []
const lastNine = { $substrCP: ['$to', { $max: [0, { $subtract: [{ $strLenCP: '$to' }, 9] }] }, 9] }

type Input = {
  channel?: unknown; all?: unknown; emails?: unknown; phones?: unknown
  status?: unknown; template?: unknown; from?: unknown; until?: unknown
  skip?: unknown; limit?: unknown; reveal?: unknown; summary?: unknown
}

/** Whose messages: null = everyone's; else a $match on `to` (an empty one matches nothing). */
async function scopeOf(channel: 'email' | 'whatsapp', input: Input): Promise<Record<string, unknown> | null> {
  if (input.all === true) return null
  const emails = emailsOf(input.emails)
  if (channel === 'email') return emails.length ? { $expr: { $in: [{ $toLower: '$to' }, emails] } } : { _id: null }
  const tails = new Set(tailsOf(input.phones))
  if (emails.length) {
    // Their phones on the LMS too: the WhatsApp went to the number on their account.
    const { UserModel } = await import('@/models/schema.ts')
    const people = await UserModel.find({ email: { $in: emails } }).collation({ locale: 'en', strength: 2 })
      .select('phone enrollmentApplication.phone').lean() as Array<{ phone?: string; enrollmentApplication?: { phone?: string } }>
    for (const t of tailsOf(people.flatMap(p => [p.phone, p.enrollmentApplication?.phone]))) tails.add(t)
  }
  return tails.size ? { $expr: { $in: [lastNine, [...tails]] } } : { _id: null }
}

async function countsSince(model: any, scope: Record<string, unknown> | null, since: Date): Promise<StatusCounts> {
  const rows = await model.aggregate([{ $match: { createdAt: { $gte: since }, ...(scope ?? {}) } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
  const c: StatusCounts = { sent: 0, failed: 0, pending: 0, total: 0 }
  for (const r of rows as Array<{ _id: string; n: number }>) {
    if (r._id === 'sent' || r._id === 'failed' || r._id === 'pending') c[r._id] = r.n
    c.total += r.n
  }
  return c
}

/** Their emails or WhatsApp messages, newest first — `skip` / `limit` — with the total, and (summary) today's and the week's counts. */
export async function messageLogsForPortal(input: Input) {
  const channel = input.channel === 'whatsapp' ? 'whatsapp' : input.channel === 'email' ? 'email' : null
  if (!channel) throw bad('channel must be email or whatsapp')
  const { EmailOutboxModel, WhatsAppOutboxModel, AuthTokenModel, UserModel } = await import('@/models/schema.ts')
  const model: any = channel === 'email' ? EmailOutboxModel : WhatsAppOutboxModel
  const scope = await scopeOf(channel, input)

  const filter: Record<string, unknown> = { ...(scope ?? {}) }
  if (typeof input.status === 'string' && STATUSES.includes(input.status)) filter['status'] = input.status
  if (channel === 'whatsapp' && typeof input.template === 'string' && /^[a-z0-9_]{1,80}$/.test(input.template)) filter['templateName'] = input.template
  const range = createdBetween(input.from, input.until)
  if (range) Object.assign(filter, range)
  const skip = Math.max(0, Math.floor(Number(input.skip) || 0))
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(input.limit) || 25)))

  const [rows, total] = await Promise.all([
    model.find(filter, channel === 'email' ? { html: 0, text: 0 } : {}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean() as Promise<any[]>,
    model.countDocuments(filter) as Promise<number>,
  ])

  let summary: { today: StatusCounts; last7Days: StatusCounts } | undefined
  let templates: { name: string; label: string }[] | undefined
  if (input.summary === true) {
    const today = zoneDateKey(new Date(), ZONE)
    const [t, w] = await Promise.all([
      countsSince(model, scope, zoneDayBounds(today, ZONE).start),
      countsSince(model, scope, zoneDayBounds(addDaysToDateKey(today, -6), ZONE).start),
    ])
    summary = { today: t, last7Days: w }
    if (channel === 'whatsapp') {
      const names = (await model.distinct('templateName', scope ?? {})) as string[]
      templates = names.sort().map(n => ({ name: n, label: WHATSAPP_TEMPLATES[n]?.label ?? n }))
    }
  }

  if (channel === 'email') {
    return {
      total, keptDays: 30, ...(summary ? { summary } : {}),
      rows: rows.map(r => ({
        id: String(r._id), to: r.to, subject: r.subject ?? '', status: r.status, attempts: r.attempts ?? 0,
        error: r.status === 'failed' ? String(r.lastError ?? '') : '', sentVia: r.sentVia ?? '', sentAt: r.sentAt ?? null, createdAt: r.createdAt,
      })),
    }
  }

  // WhatsApp: as the student read it; a one-tap button's link in full only when revealed, with where it stands.
  const reveal = input.reveal === true
  const rendered = rows.map(r => renderWhatsApp(r.templateName, r.params ?? [], r.buttonParam, { reveal }))
  const hashOf = (p: unknown) => createHash('sha256').update(String(p ?? '').split('?')[0]!).digest('hex')
  const hashes = rows.flatMap((r, i) => rendered[i]!.login ? [hashOf(r.buttonParam)] : [])
  const tokens = new Map((hashes.length
    ? await AuthTokenModel.find({ tokenHash: { $in: hashes }, purpose: { $in: ['join-link', 'signin-link'] } }).select('tokenHash expiresAt useCount maxUses').lean() as any[]
    : []).map(t => [t.tokenHash, t]))
  // Whose number each is, on the LMS.
  const tails = [...new Set(rows.map(r => String(r.to).replace(/\D/g, '').slice(-9)).filter(t => t.length >= 7))]
  const owners = tails.length
    ? await UserModel.find({ $or: [{ phone: { $in: tails.map(t => new RegExp(`${t.split('').join('\\D*')}\\D*$`)) } }, { 'enrollmentApplication.phone': { $in: tails.map(t => new RegExp(`${t.split('').join('\\D*')}\\D*$`)) } }] })
      .select('name email phone enrollmentApplication.phone').lean() as any[]
    : []
  const ownerOf = (to: string) => owners.find(u => String(u.enrollmentApplication?.phone ?? u.phone ?? '').replace(/\D/g, '').endsWith(String(to).replace(/\D/g, '').slice(-9)))
  const now = Date.now()
  return {
    total, keptDays: 30, ...(summary ? { summary } : {}), ...(templates ? { templates } : {}),
    rows: rows.map((r, i) => {
      const { login, ...shown } = rendered[i]!
      const tok = login ? tokens.get(hashOf(r.buttonParam)) : undefined
      const uses = tok?.useCount ?? 0, max = tok?.maxUses ?? LINK_MAX_SIGNINS
      const u = ownerOf(r.to)
      return {
        id: String(r._id), to: r.to, templateName: r.templateName, status: r.status, attempts: r.attempts ?? 0,
        error: r.status === 'failed' ? String(r.lastError ?? '') : '', sentAt: r.sentAt ?? null, createdAt: r.createdAt,
        ...(u ? { person: { name: u.name ?? '', email: String(u.email ?? '').toLowerCase() } } : {}),
        ...shown,
        ...(login ? { login: {
          ...login, ...(tok ? { expiresAt: tok.expiresAt } : {}), signIns: uses, maxSignIns: max,
          state: !tok || new Date(tok.expiresAt).getTime() <= now ? 'expired' : uses >= max ? 'used_up' : 'valid',
        } } : {}),
      }
    }),
  }
}

/** A student's one-time login link, made from the CS Portal by `by` — signs in once, within 24 hours. */
export async function studentLoginLinkForPortal(input: { email: unknown; byName: unknown; byEmail: unknown }) {
  const email = typeof input.email === 'string' ? input.email.toLowerCase().trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email must be one address')
  const { UserModel, AuditLogModel } = await import('@/models/schema.ts')
  const student = await UserModel.findOne({ email, role: 'student' }).select('_id name isActive organizationId').lean() as
    { _id: unknown; name?: string; isActive?: boolean; organizationId?: unknown } | null
  if (!student) throw new PortalError('NOT_FOUND', 'This student has no account in the LMS', 404)
  if (student.isActive === false) throw new PortalError('ACCOUNT_DISABLED', 'This student is deactivated in the LMS — activate them before sending a login link.', 400)
  const by = {
    name: (typeof input.byName === 'string' ? input.byName.trim() : '').slice(0, 100),
    email: (typeof input.byEmail === 'string' ? input.byEmail.trim().toLowerCase() : '').slice(0, 200),
  }
  const account = await deskAccountFor(by.email)
  const { mintAdminLoginLink } = await import('@/services/signinLink.service.ts')
  const link = await mintAdminLoginLink(String(student._id), account.id)
  await AuditLogModel.create({
    actorId: account.id, actorEmail: by.email || account.email, actorRole: account.role,
    action: 'user.loginLink', entity: 'User', entityId: String(student._id),
    meta: { via: 'tetra-commission', byName: by.name, byEmail: by.email, from: account.own ? 'own' : 'shared' },
    userAgent: 'CS Portal', organizationId: student.organizationId,
  })
  return { url: link.url, expiresAt: link.expiresAt, student: { name: student.name ?? '' } }
}
