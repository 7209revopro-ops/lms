/* ─────────────────────────────────────────────────────
   Tamara stuck-order sweep, every 10 minutes
   ─────────────────────────────────────────────────────
   An `approved` Tamara order that is not authorised within 72 hours expires,
   and the customer has already paid their first instalment
   (docs.tamara.co/docs/online-order-status-flow). We authorise when the
   webhook or the return page arrives — but a webhook can be lost and a
   student can close the tab. This walks our own pending Tamara orders and
   puts each through the SAME fulfilment the webhook uses, which asks Tamara
   for the order's real status first: nothing here trusts our own copy.

   Window: older than 5 minutes (the student may still be on Tamara's page)
   and younger than 72 hours (past that Tamara has expired it).
   Runs on the one process with the scheduler (index.ts); `running` skips a
   tick that would overlap.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

const MIN_AGE_MS = 5 * 60_000
const MAX_AGE_MS = 72 * 3_600_000
const BATCH = 50

let running = false

export async function runTamaraSweep(now = Date.now()): Promise<{ checked: number; fulfilled: number }> {
  const { OrderModel } = await import('@/models/schema.ts')
  const { OrderService } = await import('@/services/order.service.ts')
  const stuck = await OrderModel.find({
    gateway:       'tamara',
    status:        'pending',
    tamaraOrderId: { $exists: true, $ne: '' },
    createdAt:     { $gte: new Date(now - MAX_AGE_MS), $lte: new Date(now - MIN_AGE_MS) },
  }).select('_id tamaraOrderId').sort({ createdAt: 1 }).limit(BATCH).lean() as { _id: unknown; tamaraOrderId: string }[]

  const svc = new OrderService()
  let fulfilled = 0
  for (const o of stuck) {
    try {
      const outcome = await svc.fulfillTamaraFromWebhook(o.tamaraOrderId, String(o._id))
      if (outcome === 'fulfilled') fulfilled++
    } catch (err) {
      logger.error({ err, orderId: String(o._id) }, 'Tamara sweep: could not check order')
    }
  }
  return { checked: stuck.length, fulfilled }
}

export function startTamaraSweepJob(): void {
  if (!env.TAMARA_API_KEY) return
  cron.schedule('*/10 * * * *', () => {
    if (running) return
    running = true
    void runTamaraSweep()
      .then(t => { if (t.fulfilled) logger.info(t, 'Tamara sweep: recovered paid orders') })
      .catch(err => logger.error({ err }, 'Tamara sweep failed'))
      .finally(() => { running = false })
  })
}
