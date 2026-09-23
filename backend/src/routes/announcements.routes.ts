/* ─────────────────────────────────────────────────────
   GET /announcements/active — student-facing
   ─────────────────────────────────────────────────────
   Everything an admin published, live right now, for the caller's academy
   or every academy. "Live right now" is decided HERE, against the server's
   clock — the client never runs its own start/end date math, so a device
   with a wrong clock cannot see an announcement early or miss one that has
   genuinely started. The same authority split live-class status already
   uses for the same reason.

   Uses `sendSuccess` from utils/response.ts, not a local copy — it rewrites
   a stored R2 URL to the /assets proxy, which is what makes an announcement's
   banner image (uploaded through the existing /uploads/image pipeline, same
   private bucket as everything else) actually loadable by the browser.
───────────────────────────────────────────────────── */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticate } from '@/middleware/auth.middleware.ts'
import { sendSuccess } from '@/utils/response.ts'
import { AnnouncementService } from '@/services/announcement.service.ts'

const router = Router()
const announcementSvc = new AnnouncementService()

router.get('/active', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = await announcementSvc.listActiveFor(req.user!.organizationId ?? null)
    /* Only what a student needs to see. createdBy and isActive are
       staff-side bookkeeping — the row would not be in this list at all if
       isActive were false, so re-stating it here would just be a field a
       client could get confused by, not information it needs. */
    sendSuccess(res, docs.map(a => ({
      id:          String((a as { _id?: unknown })._id ?? (a as { id?: unknown }).id),
      title:       a.title,
      description: a.description,
      mediaUrl:    a.mediaUrl,
      startDate:   a.startDate,
      endDate:     a.endDate,
    })))
  } catch (err) { next(err) }
})

export default router
