/* ─────────────────────────────────────────────────────────────
   WhatsApp Logs — the admin view of WhatsAppOutboxModel, which IS the send
   log (every template message the LMS sends, its status and its error).
   super_admin only, like Email Logs: platform-wide, and full of phone numbers.

   Status is what the LMS knows: pending (queued / retrying), sent (WhatsApp
   accepted it), failed. Delivered and read would need the provider's
   delivery webhook, which is not set up.
───────────────────────────────────────────────────────────── */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticateAdmin, requireSuperAdmin } from '@/middleware/auth.middleware.ts'
import { sendSuccess, parsePagination, buildPaginationMeta } from '@/utils/response.ts'
import { createdBetween, escapeRegex, outboxSummary } from '@/utils/outboxLog.ts'
import { renderWhatsApp, WHATSAPP_TEMPLATES } from '@/utils/whatsappTemplates.ts'

const router = Router()
router.use(authenticateAdmin, requireSuperAdmin)

/* A stored phone ending in these digits, however it is written — "+971 50
   402 7626", "0504027626" — any spaces, dashes or brackets between them. */
const endsWithDigits = (digits: string) => new RegExp(`${digits.split('').map(escapeRegex).join('\\D*')}\\D*$`)

/* GET /whatsapp-logs?page&per_page&status&template&from&until&q */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { WhatsAppOutboxModel, UserModel } = await import('@/models/schema.ts')
    const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
    const qs = req.query as Record<string, string | undefined>
    const filter: Record<string, unknown> = {}
    const status = qs['status'] ? String(qs['status']) : ''
    if (['pending', 'sent', 'failed'].includes(status)) filter['status'] = status
    const template = qs['template'] ? String(qs['template']) : ''
    if (template && /^[a-z0-9_]{1,80}$/.test(template)) filter['templateName'] = template
    const range = createdBetween(qs['from'], qs['until'])
    if (range) Object.assign(filter, range)

    /* Search: a phone fragment, or a student's name / email. */
    const search = qs['q'] ? String(qs['q']).trim().slice(0, 80) : ''
    if (search) {
      const digits = search.replace(/\D/g, '')
      const people = await UserModel.find({
        $or: [{ name: { $regex: escapeRegex(search), $options: 'i' } }, { email: { $regex: escapeRegex(search), $options: 'i' } }],
      }).select('enrollmentApplication.phone phone').limit(200).lean() as any[]
      const theirDigits = people.map(p => String(p.enrollmentApplication?.phone ?? p.phone ?? '').replace(/\D/g, '')).filter(d => d.length >= 7)
      const arms: Record<string, unknown>[] = []
      if (digits.length >= 4) arms.push({ to: { $regex: escapeRegex(digits) } })
      /* Last 9 digits: a number stored with or without its country code / 0. */
      if (theirDigits.length) arms.push({ to: { $in: theirDigits.map(d => new RegExp(`${d.slice(-9)}$`)) } })
      if (!arms.length) { sendSuccess(res, [], undefined, 200, buildPaginationMeta(0, page, per_page)); return }
      filter['$or'] = arms
    }

    const [rows, total] = await Promise.all([
      WhatsAppOutboxModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * per_page).limit(per_page).lean() as Promise<any[]>,
      WhatsAppOutboxModel.countDocuments(filter),
    ])

    /* Who each number belongs to — matched on the last 9 digits. */
    const tails = [...new Set(rows.map(r => String(r.to).slice(-9)))]
    const owners = tails.length ? await UserModel.find({
      $or: [
        { 'enrollmentApplication.phone': { $in: tails.map(endsWithDigits) } },
        { phone: { $in: tails.map(endsWithDigits) } },
      ],
    }).select('name email role enrollmentApplication.phone phone').lean() as any[] : []
    const ownerOf = (to: string) => owners.find(u => String(u.enrollmentApplication?.phone ?? u.phone ?? '').replace(/\D/g, '').endsWith(String(to).slice(-9)))

    const docs = rows.map(r => {
      const u = ownerOf(r.to)
      return {
        id: String(r._id), to: r.to, templateName: r.templateName, status: r.status,
        attempts: r.attempts ?? 0, lastError: r.lastError, sentAt: r.sentAt, createdAt: r.createdAt,
        waMessageId: r.waMessageId,
        ...(u ? { person: { id: String(u._id), name: u.name, email: u.email, role: u.role } } : {}),
        ...renderWhatsApp(r.templateName, r.params ?? [], r.buttonParam),
      }
    })
    sendSuccess(res, docs, undefined, 200, buildPaginationMeta(total, page, per_page))
  } catch (err) { next(err) }
})

/* GET /whatsapp-logs/summary — sent / failed / pending, today and last 7 days. */
router.get('/summary', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { WhatsAppOutboxModel } = await import('@/models/schema.ts')
    sendSuccess(res, await outboxSummary(WhatsAppOutboxModel))
  } catch (err) { next(err) }
})

/* GET /whatsapp-logs/templates — every template name in the log, labelled. */
router.get('/templates', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { WhatsAppOutboxModel } = await import('@/models/schema.ts')
    const names = (await WhatsAppOutboxModel.distinct('templateName')) as string[]
    sendSuccess(res, names.sort().map(n => ({ name: n, label: WHATSAPP_TEMPLATES[n]?.label ?? n })))
  } catch (err) { next(err) }
})

export default router
