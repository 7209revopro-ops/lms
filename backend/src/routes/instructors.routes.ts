import { teacherMatch } from '@/utils/teaching.ts'
import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { UserModel } from '@/models/schema.ts'
import { sendSuccess } from '@/utils/response.ts'

const router = Router()

/* GET /instructors — public list of all active instructors (for client-side filter) */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const instructors = await UserModel
      .find({ ...teacherMatch(), isActive: true })
      .select('name avatarUrl headline')
      .sort({ name: 1 })
      .lean()

    sendSuccess(res, instructors.map(u => ({
      id:        String(u._id),
      name:      u.name,
      avatarUrl: u.avatarUrl ?? null,
      headline:  u.headline  ?? null,
    })))
  } catch (err) { next(err) }
})

export default router
