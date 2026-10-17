import { Router } from 'express'
import { env } from '@/config/env.ts'
import { sendSuccess } from '@/utils/response.ts'

/* ─────────────────────────────────────────────────────────────
   GET /app/config — what the student mobile app checks before anything else
   (plan.md §13.4 B5). Public: it runs before sign-in, and says nothing about
   anyone.

     minVersion     below it the app shows only "Update to continue" — the
                    escape hatch for an API change old installs cannot follow
     latestVersion  above the installed one → a dismissible "update available"
     storeUrls      where those buttons go
     maintenance    true → the app shows a maintenance screen instead of
                    failing request by request

   Every value comes from env, so a release, a forced update or a maintenance
   window is a config change and a restart — never an app release.
───────────────────────────────────────────────────────────── */
const router = Router()

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')
  sendSuccess(res, {
    minVersion:    env.MOBILE_MIN_VERSION ?? '0.0.0',
    latestVersion: env.MOBILE_LATEST_VERSION ?? env.MOBILE_MIN_VERSION ?? '0.0.0',
    storeUrls: {
      ios:     env.MOBILE_IOS_STORE_URL ?? null,
      android: env.MOBILE_ANDROID_STORE_URL ?? null,
    },
    maintenance: /^(1|true|on|yes)$/i.test(env.MOBILE_MAINTENANCE ?? ''),
  })
})

export default router
