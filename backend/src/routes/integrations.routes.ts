/* ────────────────────────────────────────────────────────────────────────────
   Server-to-server endpoints for CLT Connect.
   ────────────────────────────────────────────────────────────────────────────
   Not reachable by a browser: every route here is signed with the shared HMAC
   secret and carries no cookie session. The direction is CLT → LMS, the
   mirror of services/clt.service.ts going the other way.
──────────────────────────────────────────────────────────────────────────── */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { sendSuccess } from '@/utils/response.ts'
import { verifyCltSignature } from '@/utils/cltSignature.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { OrderService } from '@/services/order.service.ts'
import { AuthService } from '@/services/auth.service.ts'
import { logger } from '@/utils/logger.ts'

const router = Router()
const orderSvc = new OrderService()
const authSvc  = new AuthService()

/* Timing-safe secret compare for the AI-academy server-to-server call. */
function secretOk(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string' || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const FAILURE_STATUS: Record<string, number> = {
  MISSING_SIGNATURE: 401,
  STALE_TIMESTAMP:   401,
  BAD_SIGNATURE:     401,
}

const FAILURE_MESSAGE: Record<string, string> = {
  MISSING_SIGNATURE: 'Missing CLT signature headers',
  STALE_TIMESTAMP:   'Request timestamp is out of date',
  BAD_SIGNATURE:     'Bad signature',
}

/* ────────────────────────────────────────────────────────────────────────────
   POST /integrations/handoff/exchange   { code }
   ────────────────────────────────────────────────────────────────────────────
   CLT redeems a one-time code for a freshly minted join ticket.

   POST rather than GET, and the code in the BODY rather than the path, for one
   reason: a code in a URL is written to access logs on both sides. It is
   single-use and short-lived, so the exposure is small — but it costs nothing
   to not create it.

   The signature covers the code itself, not an empty body. Sign nothing and
   the same captured headers could be replayed against a different code for the
   whole freshness window; signing the code binds one signature to one code.
──────────────────────────────────────────────────────────────────────────── */
router.post('/handoff/exchange', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = String(process.env['CLT_S2S_SECRET'] ?? '')
    if (!secret) {
      res.status(503).json({
        success: false,
        error: { code: 'INTEGRATION_DISABLED', message: 'CLT integration is not configured' },
      })
      return
    }

    const code = String((req.body as { code?: unknown } | undefined)?.code ?? '')

    const failure = verifyCltSignature(
      {
        timestamp: req.headers['x-clt-timestamp'],
        nonce:     req.headers['x-clt-nonce'],
        signature: req.headers['x-clt-signature'],
      },
      code,
      secret,
    )
    if (failure) {
      logger.warn({ path: '/integrations/handoff/exchange', failure }, 'CLT S2S signature rejected')
      res.status(FAILURE_STATUS[failure] ?? 401).json({
        success: false,
        error: { code: failure, message: FAILURE_MESSAGE[failure] ?? 'Rejected' },
      })
      return
    }

    const { exchangeHandoff, HandoffError } = await import('@/services/classHandoff.service.ts')
    const { JoinError } = await import('@/services/liveClassJoin.service.ts')
    try {
      const out = await exchangeHandoff(code)
      sendSuccess(res, out, 'Handoff exchanged')
    } catch (err: any) {
      /* Both error families carry a status and a code the caller can act on:
         CODE_EXPIRED is "open the class again", NOT_BOOKED is not. Collapsing
         them into one 400 would leave CLT unable to say anything useful. */
      if (err instanceof HandoffError || err instanceof JoinError) {
        res.status(err.status).json({
          success: false,
          error: { code: err.code, message: err.message },
        })
        return
      }
      throw err
    }
  } catch (err) { next(err) }
})

/* ────────────────────────────────────────────────────────────────────────────
   POST /integrations/ai-academy/purchase   (AI-academy website → LMS)
   ────────────────────────────────────────────────────────────────────────────
   Called server-to-server by academy-api after a successful purchase. Creates /
   approves the LMS student, enrolls them in BOTH AI-academy courses, and emails
   a one-click login link. Idempotent on orderId. Secret is a shared value in
   AI_ACADEMY_S2S_SECRET (unset → integration disabled). No cookie/session.
──────────────────────────────────────────────────────────────────────────── */
const aiaPurchaseSchema = z.object({
  email:    z.string().email().toLowerCase(),
  name:     z.string().max(120).optional(),
  // Mandatory for buyers: the phone is rendered as a forensic video watermark
  // (LMS player + AI-academy v2), so a purchase can't provision without one.
  phone:    z.string().max(30).refine(v => v.replace(/\D/g, '').length >= 7, 'A valid phone number is required'),
  orderId:  z.string().min(1).max(200),
  amount:   z.coerce.number().min(0).optional(),
  currency: z.string().max(3).optional(),
  /* Which gateway took the money. Pinned to the same enum the Order schema
     stores, so an unknown value is refused at the edge rather than written
     into a column the admin table then cannot label. Optional: callers
     written before this existed keep recording 'razorpay'. */
  gateway:  z.enum(['stripe', 'razorpay', 'tabby', 'abzer', 'tamara']).optional(),
})

router.post('/ai-academy/purchase', validate(aiaPurchaseSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = String(process.env['AI_ACADEMY_S2S_SECRET'] ?? '')
    if (!secret) {
      res.status(503).json({ success: false, error: { code: 'INTEGRATION_DISABLED', message: 'AI-academy integration is not configured' } })
      return
    }
    if (!secretOk(req.headers['x-aia-secret'], secret)) {
      logger.warn('AI-academy purchase: invalid or missing X-AIA-Secret')
      res.status(401).json({ success: false, error: { code: 'UNAUTHORISED', message: 'Bad secret' } })
      return
    }

    const { email, name, phone, orderId, amount, currency, gateway } = req.body as {
      email: string; name?: string; phone?: string; orderId: string
      amount?: number; currency?: string
      gateway?: 'stripe' | 'razorpay' | 'tabby' | 'abzer' | 'tamara'
    }

    const result = await orderSvc.provisionExternalPurchase({ email, name, phone, orderId, amount, currency, gateway })

    /* Email the one-click login link — only on first provision, so webhook
       retries don't spam the buyer. */
    let loginLink: string | undefined
    if (!result.alreadyProcessed) {
      const invite = await authSvc.inviteToCourse(email, {
        next: '/courses/ai-academy-english',
        ...(name ? { name } : {}),
        courseName: 'AI Academy',
      })
      loginLink = invite.link
    }

    sendSuccess(res, { ...result, ...(loginLink ? { loginLink } : {}) }, 'Purchase provisioned')
  } catch (err) { next(err) }
})

/* ────────────────────────────────────────────────────────────────────────────
   POST /integrations/finance/enrolment   (Delta Finance → LMS)
   ────────────────────────────────────────────────────────────────────────────
   Called server-to-server when an approver signs off an enrolment invoice that
   the sales CRM raised. Creates or reuses the student, enrols and approves them
   on the mapped course, records the payment against the invoice, and emails a
   one-click login link.

   Idempotent on invoiceId: finance queues and retries, so the same approval
   arrives more than once and must provision once. Secret is a shared value in
   FINANCE_S2S_SECRET (unset → integration disabled). No cookie/session.

   The course arrives as a slug, because a name cannot identify one: finance
   holds nine spellings of three courses. Which slug belongs to which course is
   decided in finance, on the item, and only a mapped item gets this far.
──────────────────────────────────────────────────────────────────────────── */
const financeEnrolmentSchema = z.object({
  email:      z.string().email().toLowerCase(),
  name:       z.string().max(120).optional(),
  phone:      z.string().max(30).optional(),
  courseSlug: z.string().min(1).max(200),
  /* The finance invoice. The idempotency key, and the thing to quote when
     somebody asks why a student has access. */
  invoiceId:     z.string().min(1).max(200),
  invoiceNumber: z.string().max(60).optional(),
  amount:        z.coerce.number().min(0).optional(),
})

router.post('/finance/enrolment', validate(financeEnrolmentSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = String(process.env['FINANCE_S2S_SECRET'] ?? '')
    if (!secret) {
      res.status(503).json({ success: false, error: { code: 'INTEGRATION_DISABLED', message: 'Finance integration is not configured' } })
      return
    }
    if (!secretOk(req.headers['x-finance-secret'], secret)) {
      logger.warn('Finance enrolment: invalid or missing X-Finance-Secret')
      res.status(401).json({ success: false, error: { code: 'UNAUTHORISED', message: 'Bad secret' } })
      return
    }

    const { email, name, phone, courseSlug, invoiceId, invoiceNumber, amount } = req.body as {
      email: string; name?: string; phone?: string; courseSlug: string
      invoiceId: string; invoiceNumber?: string; amount?: number
    }

    let result
    try {
      result = await orderSvc.provisionFinanceEnrolment({
        email, courseSlug, externalId: invoiceId,
        ...(name ? { name } : {}), ...(phone ? { phone } : {}),
        ...(amount !== undefined ? { amount } : {}),
      })
    } catch (err) {
      /* An unmapped or renamed slug is the caller's mistake and will fail the
         same way every time, so it is a 422 rather than a 500: finance stops
         retrying and shows somebody the invoice that needs mapping. */
      const message = err instanceof Error ? err.message : 'Provisioning failed'
      if (/No course with slug/i.test(message)) {
        logger.warn({ courseSlug, invoiceId }, 'Finance enrolment: unknown course slug')
        res.status(422).json({ success: false, error: { code: 'UNKNOWN_COURSE', message } })
        return
      }
      throw err
    }

    /* Only on first provision, so a retry does not mail the student again. */
    let loginLink: string | undefined
    if (!result.alreadyProcessed) {
      const invite = await authSvc.inviteToCourse(email, {
        next: `/courses/${result.courseSlug}`,
        ...(name ? { name } : {}),
        courseName: result.courseTitle,
      })
      loginLink = invite.link
    }

    logger.info(
      { invoiceId, invoiceNumber, email, courseSlug: result.courseSlug, created: result.created, repeat: result.alreadyProcessed },
      'Finance enrolment provisioned in LMS',
    )
    sendSuccess(res, { ...result, ...(loginLink ? { loginLink } : {}) }, 'Enrolment provisioned')
  } catch (err) { next(err) }
})

export default router
