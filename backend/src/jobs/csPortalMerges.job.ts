/* ─────────────────────────────────────────────────────
   Account merges CS Portal could not be told of yet — and undos — tried
   again every minute (services/csPortalMerge.service.ts). On the one process
   with the scheduler, as the other CS Portal job.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { csPortalLinked, drainCsPortalMergesOnce } from '@/services/csPortalMerge.service.ts'
import { logger } from '@/utils/logger.ts'

let running = false

export function startCsPortalMergesJob(): void {
  if (!csPortalLinked()) return
  cron.schedule('0 * * * * *', () => {
    if (running) return
    running = true
    void drainCsPortalMergesOnce()
      .then(t => { if (t.merges || t.undos) logger.info(t, 'CS Portal merges retried') })
      .catch(err => logger.error({ err }, 'CS Portal merges retry failed'))
      .finally(() => { running = false })
  })
}
