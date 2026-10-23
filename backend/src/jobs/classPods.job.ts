/* ─────────────────────────────────────────────────────
   Class pods, every minute (services/classPod.service.ts)
   ─────────────────────────────────────────────────────
   Every online Dubai class that should hold an HRMS pod gets one, a moved one
   is re-held, and a pod held for a class that no longer needs it is let go.
   A save asks straight away; this catches the rest — imports, programs,
   scripts, the HRMS having been down, a booking cancelled on the HRMS side.
   Runs on the one process with the scheduler (index.ts); `running` skips a
   tick that would overlap.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { podsConfigured, runPodSweep } from '@/services/classPod.service.ts'
import { logger } from '@/utils/logger.ts'

let running = false

export function startClassPodsJob(): void {
  if (!podsConfigured()) {
    logger.info('HRMS pods are not configured — online classes are not given meeting pods')
    return
  }
  logger.info('HRMS pods are configured — online Dubai classes are given meeting pods')
  cron.schedule('30 * * * * *', () => {
    if (running) return
    running = true
    void runPodSweep()
      .then(t => { if (t.synced || t.released) logger.info(t, 'Class pods sweep') })
      .catch(err => logger.error({ err }, 'Class pods sweep failed'))
      .finally(() => { running = false })
  })
}
