import { EmailOutboxModel, type IEmailOutbox, type EmailOutboxStatus } from '@/models/schema.ts'
import { createdBetween, escapeRegex } from '@/utils/outboxLog.ts'

export class EmailOutboxRepository {
  /* EmailOutboxModel already IS the send log (see its own comment in
     schema.ts) — this just reads it the way AuditLogRepository.list() reads
     AuditLogModel: filtered, newest first, paginated. No new schema needed. */
  async list(page: number, perPage: number, filter: {
    status?: string
    to?:     string
    /* Recipient OR subject, partial. */
    q?:      string
    from?:   string
    until?:  string
  } = {}): Promise<{ docs: IEmailOutbox[]; totalCount: number }> {
    const q: Record<string, unknown> = {}

    /* String()-coerce before comparing against the enum: req.query can
       smuggle an object or array (?status[$ne]=sent) that Mongo would
       otherwise read as an operator — same guard AuditLogRepository uses. */
    const status = filter.status ? String(filter.status) : undefined
    if (status && (['pending', 'sent', 'failed'] as EmailOutboxStatus[]).includes(status as EmailOutboxStatus)) {
      q['status'] = status
    }

    /* Partial, case-insensitive match on recipient — an admin searching this
       log almost always has a fragment of an email address, not the exact
       string. Escaped so a caller can't turn "to" into a regex DoS or an
       unintended pattern via .* etc. */
    const to = filter.to ? String(filter.to).trim() : undefined
    if (to) {
      const escaped = to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      q['to'] = { $regex: escaped, $options: 'i' }
    }

    const search = filter.q ? String(filter.q).trim().slice(0, 120) : ''
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: 'i' }
      q['$or'] = [{ to: rx }, { subject: rx }]
    }
    const range = createdBetween(filter.from, filter.until)
    if (range) Object.assign(q, range)

    const [docs, totalCount] = await Promise.all([
      EmailOutboxModel.find(q, { html: 0 }) // the full HTML body is never needed for a list row
        .sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).exec(),
      EmailOutboxModel.countDocuments(q).exec(),
    ])
    return { docs, totalCount }
  }

  /* One row's full HTML — fetched only when an admin expands it, not on
     every list page. Keeps the list query cheap regardless of how large a
     stored email body is. */
  async findHtml(id: string): Promise<string | null> {
    const row = await EmailOutboxModel.findById(id, { html: 1 }).lean().exec()
    return row?.html ?? null
  }
}
