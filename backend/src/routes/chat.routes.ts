import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import {
  authenticate, authenticateAdmin, requireRole, requireSuperAdmin,
} from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { chatSendRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { sendSuccess, sendError } from '@/utils/response.ts'
import * as chat from '@/services/chat.service.ts'

/* plan.md §11.5 — three doors, each with its own session:
     /chat/*            student  (lms_at; impersonation is read-only — C4)
     /chat/staff/*      instructor (lms_admin_at)
     /chat/oversight/*  super_admin, read-only, follows the org switcher (C5) */

const sendSchema  = z.object({
  instructorId: z.string().min(1),
  body:         z.string().min(1).max(4000),   // trimmed + capped at 2000 in the service
  clientMsgId:  z.string().max(64).optional(),
})
const replySchema = sendSchema.omit({ instructorId: true })

type H = (req: Request, res: Response) => Promise<void>
const wrap = (fn: H) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next) }
const q = (req: Request) => req.query as Record<string, string | undefined>

/* ── Instructor ─────────────────────────────────────── */
const staff = Router()
staff.use(authenticateAdmin, requireRole('instructor'))
staff.get('/conversations', wrap(async (req, res) => {
  sendSuccess(res, await chat.conversationsForInstructor(req.user!.id, q(req)))
}))
staff.get('/unread-count', wrap(async (req, res) => {
  sendSuccess(res, { count: await chat.unreadTotal(req.user!.id, 'instructor') })
}))
staff.get('/conversations/:id/messages', wrap(async (req, res) => {
  const conv = await chat.conversationForInstructor(req.params['id'], req.user!.id)
  /* Opening the thread (no cursor) also says whether a reply is possible, so
     the composer can explain itself instead of failing on send. Polls skip it. */
  const opening = !q(req)['after'] && !q(req)['before']
  const blocked = opening ? await chat.replyBlockedReason(conv) : undefined
  sendSuccess(res, {
    messages: await chat.messagesOf(conv, q(req)), peerLastReadAt: chat.peerLastReadAt(conv, 'instructor'),
    ...(opening ? { canReply: !blocked, readOnlyReason: blocked?.message ?? null } : {}),
  })
}))
staff.post('/conversations/:id/messages', chatSendRateLimit, validate(replySchema), wrap(async (req, res) => {
  sendSuccess(res, await chat.replyAsInstructor(req.user!.id, req.params['id'], req.body), 'Sent', 201)
}))
staff.post('/conversations/:id/read', wrap(async (req, res) => {
  const conv = await chat.conversationForInstructor(req.params['id'], req.user!.id)
  sendSuccess(res, await chat.markRead(conv, 'instructor'))
}))
/* Anything else under this door is a 404 here — never a fall-through to the
   student door, whose 401 would read to the admin app as an expired session. */
staff.use((_req, res) => { sendError(res, 'NOT_FOUND', 'Not found', 404) })

/* ── Super admin, read-only ─────────────────────────── */
const oversight = Router()
oversight.use(authenticateAdmin, requireSuperAdmin)
oversight.get('/conversations', wrap(async (req, res) => {
  sendSuccess(res, await chat.conversationsForOversight({ ...q(req), orgId: req.user!.organizationId }))
}))
oversight.get('/instructors', wrap(async (req, res) => {
  sendSuccess(res, await chat.oversightInstructors(req.user!.organizationId))
}))
oversight.get('/conversations/:id/messages', wrap(async (req, res) => {
  const conv = await chat.conversationForOversight(req.params['id'], req.user!.organizationId)
  sendSuccess(res, { messages: await chat.messagesOf(conv, q(req)) })
}))
oversight.use((_req, res) => { sendError(res, 'NOT_FOUND', 'Not found', 404) })

/* ── Student ────────────────────────────────────────── */
const student = Router()
student.use(authenticate, requireRole('student'))
student.get('/instructors', wrap(async (req, res) => {
  sendSuccess(res, await chat.eligibleInstructors(req.user!.id))
}))
student.get('/conversations', wrap(async (req, res) => {
  sendSuccess(res, await chat.conversationsForStudent(req.user!.id))
}))
student.get('/unread-count', wrap(async (req, res) => {
  sendSuccess(res, { count: await chat.unreadTotal(req.user!.id, 'student') })
}))
student.get('/conversations/:id/messages', wrap(async (req, res) => {
  const conv = await chat.conversationForStudent(req.params['id'], req.user!.id)
  sendSuccess(res, { messages: await chat.messagesOf(conv, q(req)), peerLastReadAt: chat.peerLastReadAt(conv, 'student') })
}))
student.post('/messages', chatSendRateLimit, validate(sendSchema), wrap(async (req, res) => {
  sendSuccess(res, await chat.sendAsStudent(req.user!.id, req.body), 'Sent', 201)
}))
student.post('/conversations/:id/read', wrap(async (req, res) => {
  const conv = await chat.conversationForStudent(req.params['id'], req.user!.id)
  sendSuccess(res, await chat.markRead(conv, 'student'))
}))

const router = Router()
router.use('/staff', staff)
router.use('/oversight', oversight)
router.use('/', student)
export default router
