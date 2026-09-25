/* ─────────────────────────────────────────────────────
   WhatsApp outbox drain — mirrors emailOutbox.job.ts exactly
   ─────────────────────────────────────────────────────
   Replays anything the immediate send in whatsapp.service.ts could not
   deliver: a rate-limited Creatyvot/Meta account, a network blip, a redeploy
   mid-send. Rows stay `pending` with a backoff, and this sweeps them until
   they go out or exhaust MAX_WHATSAPP_ATTEMPTS.

   Runs on the primary PM2 instance only (see index.ts) — same reason as
   every other cron job here: N instances draining the same rows would send
   duplicate WhatsApp messages, which is far more visible to a student than
   a duplicate email.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { WhatsAppOutboxModel } from '@/models/schema.ts'
import { deliverWhatsAppOutboxRow } from '@/services/whatsapp.service.ts'
import { logger } from '@/utils/logger.ts'

const BATCH = Number(process.env['WHATSAPP_OUTBOX_BATCH'] ?? 25)

/* Same reasoning as EMAIL_OUTBOX_MAX_AGE_HOURS: without a floor, a restart
   after an outage would fire a burst of stale "class starting soon" and
   "booking confirmed" messages about sessions that already happened. */
const MAX_AGE_HOURS = Number(process.env['WHATSAPP_OUTBOX_MAX_AGE_HOURS'] ?? 24)

let running = false

async function expireStale(now: Date): Promise<number> {
  if (MAX_AGE_HOURS <= 0) return 0
  const cutoff = new Date(now.getTime() - MAX_AGE_HOURS * 3600 * 1000)
  const r = await WhatsAppOutboxModel.updateMany(
    { status: 'pending', createdAt: { $lt: cutoff } },
    { $set: { status: 'failed', lastError: `expired: queued more than ${MAX_AGE_HOURS}h ago, not sent` } },
  )
  if (r.modifiedCount > 0) {
    logger.warn({ expired: r.modifiedCount, olderThanHours: MAX_AGE_HOURS },
      'whatsapp outbox: retired stale backlog rather than sending messages about the past')
  }
  return r.modifiedCount
}

export async function drainWhatsAppOutboxOnce(): Promise<{ sent: number; retry: number; failed: number }> {
  const tally = { sent: 0, retry: 0, failed: 0 }

  const now = new Date()
  await expireStale(now)

  const due = await WhatsAppOutboxModel
    .find({ status: 'pending', nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1 })
    .limit(BATCH)
    .lean()

  for (const row of due as unknown as {
    _id: unknown; to: string; templateName: string; languageCode: string; params: string[]; buttonParam?: string; attempts: number
  }[]) {
    const outcome = await deliverWhatsAppOutboxRow({
      id: String(row._id), to: row.to, templateName: row.templateName,
      languageCode: row.languageCode, params: row.params ?? [], buttonParam: row.buttonParam, attempts: row.attempts ?? 0,
    })
    tally[outcome === 'sent' ? 'sent' : outcome === 'failed' ? 'failed' : 'retry']++
  }

  return tally
}

export function startWhatsAppOutboxJob(): void {
  cron.schedule('* * * * *', () => {
    if (running) return
    running = true
    void drainWhatsAppOutboxOnce()
      .then(t => {
        if (t.sent || t.failed) logger.info(t, 'whatsapp outbox drained')
        else if (t.retry)       logger.debug(t, 'whatsapp outbox — all deferred')
      })
      .catch(err => logger.error({ err }, 'whatsapp outbox drain failed'))
      .finally(() => { running = false })
  })

  cron.schedule('0 * * * *', () => {
    void (async () => {
      const [pending, failed] = await Promise.all([
        WhatsAppOutboxModel.countDocuments({ status: 'pending' }),
        WhatsAppOutboxModel.countDocuments({ status: 'failed' }),
      ])
      if (pending > 50 || failed > 0) {
        logger.warn({ pending, failed }, 'whatsapp outbox backlog — check Creatyvot/Meta account status')
      }
    })().catch(err => logger.error({ err }, 'whatsapp outbox health check failed'))
  })

  logger.info({ batch: BATCH }, 'WhatsApp outbox drain started (every minute)')
}
