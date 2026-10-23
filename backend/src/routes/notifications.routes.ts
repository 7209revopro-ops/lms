import { Router } from 'express'
import { NotificationController } from '@/controllers/notification.controller.ts'
import { authenticate, authenticateAdmin } from '@/middleware/auth.middleware.ts'
import { sendError, sendSuccess } from '@/utils/response.ts'

const router = Router()
const ctrl   = new NotificationController()

/* The admin panel's bell (a mentor's "new message from a student", 2026-10-18):
   the same feed, read through the admin session cookie. Mounted first and
   closed with its own 404 so a staff request never falls through to the
   student session below. */
const staff = Router()
staff.use(authenticateAdmin)
staff.get ('/',              ctrl.list)
staff.get ('/unread-count',  ctrl.unreadCount)
staff.post('/read-all',      ctrl.markAllRead)
staff.post('/:id/read',      ctrl.markRead)
staff.use((_req, res) => { sendError(res, 'NOT_FOUND', 'Not found', 404) })
router.use('/staff', staff)

router.use(authenticate)
/* Phone / desktop notifications (Web Push, 2026-10-21): the key to subscribe with, and this device on / off. */
router.get ('/push/key', (_req, res) => {
  void import('@/services/push.service.ts').then(m => sendSuccess(res, { publicKey: m.pushPublicKey() }))
})
router.post('/push/subscribe', async (req, res, next) => {
  try {
    const { savePushSubscription } = await import('@/services/push.service.ts')
    const r = await savePushSubscription(req.user!.id, 'client', req.body?.subscription, req.get('user-agent'))
    if (!r.ok) { sendError(res, 'INVALID_SUBSCRIPTION', 'That is not a valid push subscription', 400); return }
    sendSuccess(res, { subscribed: true })
  } catch (err) { next(err) }
})
router.post('/push/unsubscribe', async (req, res, next) => {
  try {
    const { removePushSubscription } = await import('@/services/push.service.ts')
    await removePushSubscription(req.user!.id, req.body?.endpoint)
    sendSuccess(res, { subscribed: false })
  } catch (err) { next(err) }
})
router.get ('/',              ctrl.list)
router.get ('/unread-count',  ctrl.unreadCount)
router.post('/read-all',      ctrl.markAllRead)
router.post('/:id/read',      ctrl.markRead)

export default router
