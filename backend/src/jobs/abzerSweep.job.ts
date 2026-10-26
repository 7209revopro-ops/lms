/* ─────────────────────────────────────────────────────
   Abzer stuck-order sweep, every 10 minutes
   ─────────────────────────────────────────────────────
   An Abzer order becomes paid when its WH_RECEIPT_POSTING webhook arrives or
   the buyer's return page confirms it. Both can be missed: the webhook is
   configured by hand in the BillXPro console and is lost if that setting is
   wrong or our server is down, and a buyer can close the tab on Abzer's own
   receipt page. On the sandbox (2026-10-26) five PAID requests were still
   pending on our side for exactly this reason.

   This walks our own pending Abzer orders and puts each through the SAME
   verified fulfilment the return page uses, which reads Abzer's record of
   the request first: nothing here trusts our own copy.

   Window: older than 5 minutes (the buyer may still be on the hosted page)
   and younger than 7 days. A link stays payable for 30 days, but a payment
   that late is rare and a person should see it; recovering last week's
   orders keeps a first deploy from enrolling — and emailing — buyers of long
   ago. Runs on the one process with the scheduler (index.ts); `running`
   skips a tick that would overlap.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

const MIN_AGE_MS = 5 * 60_000
const MAX_AGE_MS = 7 * 24 * 3_600_000
const BATCH = 50

let running = false

export async function runAbzerSweep(now = Date.now()): Promise<{ checked: number; fulfilled: number }> {
  const { OrderModel } = await import('@/models/schema.ts')
  const { OrderService } = await import('@/services/order.service.ts')
  const stuck = await OrderModel.find({
    gateway:      'abzer',
    status:       'pending',
    abzerOrderId: { $exists: true, $ne: '' },
    createdAt:    { $gte: new Date(now - MAX_AGE_MS), $lte: new Date(now - MIN_AGE_MS) },
  }).select('_id').sort({ createdAt: 1 }).limit(BATCH).lean() as { _id: unknown }[]

  const svc = new OrderService()
  let fulfilled = 0
  for (const o of stuck) {
    try {
      const outcome = await svc.fulfillAbzerVerified(String(o._id))
      if (outcome === 'fulfilled') fulfilled++
    } catch (err) {
      logger.error({ err, orderId: String(o._id) }, 'Abzer sweep: could not check order')
    }
  }
  return { checked: stuck.length, fulfilled }
}

export function startAbzerSweepJob(): void {
  if (!env.ABZER_ACCESS_KEY || !env.ABZER_SECRET_KEY) return
  cron.schedule('*/10 * * * *', () => {
    if (running) return
    running = true
    void runAbzerSweep()
      .then(t => { if (t.fulfilled) logger.info(t, 'Abzer sweep: recovered paid orders') })
      .catch(err => logger.error({ err }, 'Abzer sweep failed'))
      .finally(() => { running = false })
  })
}
