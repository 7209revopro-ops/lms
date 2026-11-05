import type { Request, Response, NextFunction } from 'express'
import { SupportService } from '@/services/support.service.ts'
import { sendSuccess } from '@/utils/response.ts'

async function requester(req: Request) {
  const role = req.user!.role as any
  // Tenant context. `authenticateAny` (the shared owner-or-staff routes) does not
  // load organizationId, so fall back to the caller's own record. super_admin is
  // never org-scoped, so skip the lookup for them entirely.
  let organizationId = req.user!.organizationId
  if (!organizationId && role !== 'super_admin') {
    const { UserModel } = await import('@/models/schema.ts')
    const self = await UserModel.findById(req.user!.id).select('organizationId').lean()
    /* No record at all is NOT the same as "no academy on record" (P-18).
       A deleted account whose token is still live used to land here with
       organizationId undefined, which orgScope() reads as unscoped — so it
       could read and reply to every academy's tickets. A record that EXISTS
       but carries no academy still falls through unscoped, as intended. */
    if (!self) {
      const { SupportError } = await import('@/services/support.service.ts')
      throw new SupportError('ACCOUNT_GONE', 'This account no longer exists.', 401)
    }
    organizationId = (self as any)?.organizationId?.toString()
  }
  // Normalize all staff roles so the service recognises them
  return {
    id:            req.user!.id,
    role,
    categoryScope: (req.user as any).categoryScope as '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | 'cma' | undefined,
    organizationId,
  }
}

export class SupportController {
  private readonly service = new SupportService()

  /* ── Client ── */
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { subject, category, message } = req.body as { subject: string; category?: any; message: string }

      // Attach the student's program so tickets are scoped to their category.
      // If enrolled in exactly 1 program → scope to that team.
      // If enrolled in 0 or 2+ programs → leave undefined so all relevant admin
      // teams (and super admins) can see the ticket.
      let program: string | undefined
      const userRole = req.user!.role
      if (userRole === 'student') {
        const { UserModel } = await import('@/models/schema.ts')
        const user = await UserModel.findById(req.user!.id).select('category categories').lean()
        const VALID = ['4x-trading', 'digital-marketing', 'ai', 'jura', 'cma'] as const
        type ValidProg = typeof VALID[number]
        const multi  = ((user as any)?.categories as string[] | undefined) ?? []
        const single = (user as any)?.category as string | undefined
        const all    = (multi.length ? multi : single ? [single] : [])
                         .filter((c): c is ValidProg => VALID.includes(c as ValidProg))
        if (all.length === 1) program = all[0]
        // 0 or 2+ programs → program stays undefined → visible to all admin teams
      }

      const ticket = await this.service.create(await requester(req), { subject, category, message, program })
      sendSuccess(res, ticket, 'Ticket created', 201)
    } catch (err) { next(err) }
  }

  myTickets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await this.service.listForUser(req.user!.id))
    } catch (err) { next(err) }
  }

  /* ── Shared (owner or staff) ── */
  getOne = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await this.service.getOne(String(req.params['id'] ?? ''), await requester(req)))
    } catch (err) { next(err) }
  }

  addMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { body } = req.body as { body: string }
      sendSuccess(res, await this.service.addMessage(String(req.params['id'] ?? ''), await requester(req), body))
    } catch (err) { next(err) }
  }

  /* ── Admin ── */
  listAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status  = req.query['status']  ? String(req.query['status'])  : undefined
      const search  = req.query['search']  ? String(req.query['search'])  : undefined
      // category-scoped admins are restricted to their program; super/admin can pass ?program= to filter
      const scope   = (req.user as any).categoryScope as string | undefined
      const program = scope ?? (req.query['program'] ? String(req.query['program']) : undefined)
      sendSuccess(res, await this.service.listAll({ status, search, program }, await requester(req)))
    } catch (err) { next(err) }
  }

  stats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const scope   = (req.user as any).categoryScope as string | undefined
      const program = scope ?? (req.query['program'] ? String(req.query['program']) : undefined)
      sendSuccess(res, await this.service.adminStats(program, await requester(req)))
    } catch (err) { next(err) }
  }

  performance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await this.service.adminPerformance(await requester(req)))
    } catch (err) { next(err) }
  }

  setStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status } = req.body as { status: any }
      sendSuccess(res, await this.service.setStatus(String(req.params['id'] ?? ''), status, await requester(req)), 'Status updated')
    } catch (err) { next(err) }
  }
}
