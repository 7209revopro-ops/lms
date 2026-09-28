/* ─────────────────────────────────────────────────────
   New students → Tetra Commission, every minute
   ─────────────────────────────────────────────────────
   The sweep itself is services/commissionStudents.service.ts. Runs on the one
   process with the scheduler (see index.ts), like the outbox drains: two
   processes sweeping the same students would send each twice — harmless on
   the far side, which is idempotent, but pointless.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { commissionConfigured, drainCommissionStudentsOnce } from '@/services/commissionStudents.service.ts'
import { logger } from '@/utils/logger.ts'

let running = false

export function startCommissionStudentsJob(): void {
  if (!commissionConfigured()) {
    logger.info('Tetra Commission is not configured — new students are not sent there')
    return
  }
  logger.info('Tetra Commission is configured — new students are sent there')
  cron.schedule('* * * * *', () => {
    if (running) return
    running = true
    void drainCommissionStudentsOnce()
      .then(t => { if (t.sent || t.skipped || t.failed) logger.info(t, 'Tetra Commission students sweep') })
      .catch(err => logger.error({ err }, 'Tetra Commission students sweep failed'))
      .finally(() => { running = false })
  })
}
