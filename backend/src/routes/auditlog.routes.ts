import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticateAdmin, requireAdmin, requirePagePermission } from '@/middleware/auth.middleware.ts'
import { sendSuccess, parsePagination, buildPaginationMeta } from '@/utils/response.ts'
import { AuditLogRepository } from '@/repositories/auditlog.repository.ts'

const router = Router()
const repo   = new AuditLogRepository()

/* GET /audit-logs — super_admin + admin only.
   The trail exposes actorEmail / ip / userAgent / meta platform-wide, so it stays
   off requireAnyAdmin (support, sub_admin).
   Tenant-scoped (H-12): an org admin sees only their own academy's trail plus
   entries that predate the field. super_admin is unscoped. */
router.get(
  '/',
  authenticateAdmin,
  requireAdmin,
  requirePagePermission('audit-logs'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const q = req.query as Record<string, string | undefined>
      const { resolveCallerOrg, callerIsGone } = await import('@/utils/tenancy.ts')

      /* A deleted account whose token is still live must not read the trail at
         all. Without this its ACCOUNT_GONE result fell through the
         `typeof === 'string'` test below to `undefined` — i.e. UNSCOPED — and
         returned every academy's actorEmail / ip / userAgent (P-18). */
      if (req.user!.role !== 'super_admin' && await callerIsGone(req)) {
        res.status(401).json({
          success: false,
          error: { code: 'ACCOUNT_GONE', message: 'This account no longer exists.' },
        })
        return
      }

      const callerOrg = req.user!.role === 'super_admin' ? null : await resolveCallerOrg(req)

      const { docs, totalCount } = await repo.list(page, per_page, {
        actorId: q['actorId'],
        action:  q['action'],
        entity:  q['entity'],
        organizationId: typeof callerOrg === 'string' ? callerOrg : undefined,
      })
      sendSuccess(res, docs, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
    } catch (err) {
      next(err)
    }
  },
)

export default router
