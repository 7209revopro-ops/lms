/* ─────────────────────────────────────────────────────
   CS Portal asking the LMS to merge, or unmerge, two students' accounts
   (services/csPortalMerge.service.ts; 2026-11-12) — when it merged the two
   students on its Duplicates page. Server to server: the secret only these
   two share (COMMISSION_S2S_SECRET), in x-commission-secret.
───────────────────────────────────────────────────── */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { sendSuccess, sendError } from '@/utils/response.ts'

const router = Router()

router.use((req: Request, res: Response, next: NextFunction) => {
  const expected = String(process.env['COMMISSION_S2S_SECRET'] ?? '')
  if (!expected) { sendError(res, 'NOT_CONFIGURED', 'CS Portal is not linked to this server (COMMISSION_S2S_SECRET)', 503); return }
  const presented = req.headers['x-commission-secret']
  const a = Buffer.from(typeof presented === 'string' ? presented : ''), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) { sendError(res, 'UNAUTHORIZED', 'Bad secret', 401); return }
  next()
})

router.post('/merge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mergeFromCsPortal } = await import('@/services/csPortalMerge.service.ts')
    sendSuccess(res, await mergeFromCsPortal(req.body ?? {}))
  } catch (err) { next(err) }
})

router.post('/merge/undo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { undoFromCsPortal } = await import('@/services/csPortalMerge.service.ts')
    sendSuccess(res, await undoFromCsPortal(req.body ?? {}))
  } catch (err) { next(err) }
})

export default router
