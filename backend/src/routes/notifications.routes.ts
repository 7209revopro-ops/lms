import { Router } from 'express'
import { NotificationController } from '@/controllers/notification.controller.ts'
import { authenticate, authenticateAdmin } from '@/middleware/auth.middleware.ts'
import { sendError } from '@/utils/response.ts'

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
router.get ('/',              ctrl.list)
router.get ('/unread-count',  ctrl.unreadCount)
router.post('/read-all',      ctrl.markAllRead)
router.post('/:id/read',      ctrl.markRead)

export default router
