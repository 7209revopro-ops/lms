import mongoose from 'mongoose'
import { PortalError } from '@/services/portal.service.ts'

/* ─────────────────────────────────────────────────────────────
   One student's emails from the LMS (the portal's student page, 2026-10-17): what the email queue
   (EmailOutbox) holds for their address — sent mail is kept 30 days, pending and failed mail until
   cleared. Read only: the list without bodies, and one email's body on its own.
───────────────────────────────────────────────────────────── */

const fail = (message: string, statusCode = 400) => new PortalError(statusCode === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', message, statusCode)
const emailOf = (v: unknown) => {
  const e = String(v ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw fail('A valid email is required')
  return e
}
/* The address in any letter case (the queue keeps it as it was given). */
const sameAddress = (e: string) => ({ $regex: `^${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' })

export async function studentEmailsForPortal(email: unknown, limit: unknown) {
  const e = emailOf(email)
  const n = Math.min(500, Math.max(1, Math.floor(Number(limit) || 200)))
  const { EmailOutboxModel } = await import('@/models/schema.ts')
  const rows = await EmailOutboxModel.find({ to: sameAddress(e) }, { html: 0, text: 0 }).sort({ createdAt: -1 }).limit(n).lean() as any[]
  return {
    keptDays: 30,
    emails: rows.map(r => ({
      id: String(r._id), subject: r.subject ?? '', status: r.status, createdAt: r.createdAt, sentAt: r.sentAt ?? null,
      error: r.status === 'failed' ? String(r.lastError ?? '') : '', attempts: r.attempts ?? 0,
    })),
  }
}

export async function studentEmailForPortal(id: unknown, email: unknown) {
  const e = emailOf(email)
  if (!mongoose.isValidObjectId(String(id ?? ''))) throw fail('No such email', 404)
  const { EmailOutboxModel } = await import('@/models/schema.ts')
  const r = await EmailOutboxModel.findOne({ _id: String(id), to: sameAddress(e) }).lean() as any
  if (!r) throw fail('No such email', 404)
  return { id: String(r._id), subject: r.subject ?? '', status: r.status, createdAt: r.createdAt, sentAt: r.sentAt ?? null, html: r.html ?? '', text: r.text ?? '' }
}
