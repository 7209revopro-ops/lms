import { Router, type Request, type Response, type NextFunction } from 'express'
import { sendSuccess } from '@/utils/response.ts'
import { authRateLimit } from '@/middleware/rateLimit.middleware.ts'

/* ─────────────────────────────────────────────────────────────
   A programme's shareable link — /p/{joinCode} in the student app (2026-10-17).
   No sign-in: it is for people without an LMS account. Nothing here says who
   is on a programme.
     GET  /public/programs/:code        what the page shows
     POST /public/programs/:code/join   the form: { name, email, phone } →
                                        the class's join link when it can be
                                        joined (an LMS student on it: sign in)
───────────────────────────────────────────────────────────── */
const router = Router()

router.get('/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { programPublic } = await import('@/services/program.service.ts')
    sendSuccess(res, await programPublic(String(req.params['code'] ?? '').toLowerCase()))
  } catch (err) { next(err) }
})

router.post('/:code/join', authRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { joinAsGuest } = await import('@/services/program.service.ts')
    sendSuccess(res, await joinAsGuest(String(req.params['code'] ?? '').toLowerCase(), (req.body ?? {}) as Record<string, unknown>))
  } catch (err) { next(err) }
})

export default router
