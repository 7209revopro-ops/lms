import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { authenticate } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { isExpoPushToken, registerPushToken, removePushToken } from '@/services/push.service.ts'
import { mobileDeviceId } from '@/utils/mobileClient.ts'
import { sendSuccess } from '@/utils/response.ts'

/* ─────────────────────────────────────────────────────────────
   /push-tokens — the student app registers the phone it is signed in on for
   push notifications, and removes it when signing out (plan.md §13.4 B3).

     POST   { token, platform, appVersion? }  → register / move to this account
     DELETE { token }                         → stop pushing to this phone

   Registering needs a signed-in session (a Bearer from the app). Removing
   does NOT: an app whose session has already died (refused refresh, revoked
   device) can no longer authenticate, and must still be able to stop that
   account's pushes reaching the phone. The token is the phone's own secret —
   holding it is the proof — and removing it can only ever stop pushes.
───────────────────────────────────────────────────────────── */
const router = Router()

const token = z.string().max(255).refine(isExpoPushToken, 'Not an Expo push token')

router.post('/', authenticate,
  validate(z.object({
    token,
    platform:   z.enum(['ios', 'android']),
    appVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await registerPushToken(req.user!.id, {
        token: req.body.token, platform: req.body.platform, appVersion: req.body.appVersion,
        deviceId: mobileDeviceId(req) ?? undefined,
      })
      sendSuccess(res, { registered: true })
    } catch (err) { next(err) }
  })

router.delete('/', validate(z.object({ token })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await removePushToken(req.body.token)
      sendSuccess(res, { removed: true })
    } catch (err) { next(err) }
  })

export default router
