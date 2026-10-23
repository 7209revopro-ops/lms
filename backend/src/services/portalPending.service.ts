import { Types } from 'mongoose'
import type { Request } from 'express'
import { UserModel, RoleModel, ChatConversationModel } from '@/models/schema.ts'
import { SupportService } from '@/services/support.service.ts'
import { studentReachClause } from '@/utils/departmentScope.ts'
import { andFilter } from '@/utils/tenancy.ts'
import { toStudentProgram } from '@/utils/programVocabulary.ts'

/* ─────────────────────────────────────────────────────────────
   What is waiting in the LMS, for the Root portal's Pending page (the user,
   2026-10-11: every portal's own sidebar badges, and who each is waiting on).
   Read only. GET /service/pending, Root portal's secret only.

   The admin sidebar (admin/src/components/layout/AdminSidebar.tsx) carries
   these badges, in its order:

     Requests  enrolment_requests  applicants waiting for approval — the
               Requests page's pending tab (GET /admin/enrollment-requests
               ?status=pending, meta.total_count). Shared: every active
               super_admin / admin / sub_admin / support account gets the count
               its OWN badge shows — a super admin both academies, an admin or
               support account its academy, a department head (sub_admin) its
               academy's applicants to its department.
     Support   support_tickets     tickets a student wrote on that no admin has
               opened since (adminUnread — GET /support/admin/stats → unread).
               Shared, the same roles and the same scoping as Requests; a
               custom role that may not list tickets (support.list, while
               PERMISSIONS_MODE enforces) cannot work them, so it is left out.
     Messages  chat_messages       students' chat messages a mentor has not
               read (GET /chat/staff/unread-count). The instructors' own badge
               — a super admin has none — so it counts against each mentor:
               total is every mentor's unread, an inactive mentor's included
               (shown inactive, so it is visible that nobody will read them).

   Left out: Live Classes' pulsing badge, which counts classes live right now —
   nothing is waiting on anyone.

   The super admin's view is "All Orgs" (no X-Organization-Id): no academy
   filter, so each shared total is Dubai's and Bangalore's together.
───────────────────────────────────────────────────────────── */

type Role = 'super_admin' | 'admin' | 'sub_admin' | 'support' | 'instructor'
const ADMIN_ROLES: readonly Role[] = ['super_admin', 'admin', 'sub_admin', 'support']

interface Staff {
  _id: Types.ObjectId
  name?: string
  email?: string
  role: Role
  isActive?: boolean
  organizationId?: Types.ObjectId | null
  program?: string | null
  customRoleId?: Types.ObjectId | null
}

export interface PendingKind { key: string; label: string; total: number; overdue?: number; shared?: true }
export interface PendingPerson { id: string; name: string; email: string; active: boolean; counts: Record<string, number>; total: number }

/** The academy and department a staff account's own badges are drawn for. */
function viewOf(u: Staff): { org: string | undefined; department: string | null | undefined } {
  /* super_admin: the switcher's "All Orgs". Everyone else: their account's academy (none on record → unscoped, as the routes do). */
  const org = u.role === 'super_admin' ? undefined : u.organizationId ? String(u.organizationId) : undefined
  /* sub_admin: their department — none or unknown and the routes refuse them (injectCategoryScope), so the badge stays empty. */
  const department = u.role === 'sub_admin' ? (toStudentProgram(u.program) ?? null) : undefined
  return { org, department }
}

/** The Requests badge as this account sees it — the filter of AdminController.listEnrollmentRequests, status pending. */
async function pendingRequestsFor(u: Staff, view: ReturnType<typeof viewOf>): Promise<number> {
  if (view.department === null) return 0
  const filter: Record<string, unknown> = {
    role: 'student',
    enrollmentStatus: 'pending',
    $and: [{ $or: [{ signupType: { $ne: 'express' } }, { enrollmentStatus: { $in: ['rejected', 'cancelled'] } }] }],
  }
  if (view.org && Types.ObjectId.isValid(view.org)) filter['organizationId'] = new Types.ObjectId(view.org)
  /* The department clause from the very helper the route uses, on a request shaped like theirs. */
  const req = { user: { id: String(u._id), role: u.role, organizationId: view.org, program: u.program ?? undefined, categoryScope: view.department ?? undefined } } as unknown as Request
  andFilter(filter, await studentReachClause(req))
  return UserModel.countDocuments(filter)
}

/** The Support badge as this account sees it — SupportService.adminStats, the endpoint's own code. */
async function unreadTicketsFor(u: Staff, view: ReturnType<typeof viewOf>): Promise<number> {
  if (view.department === null) return 0
  const stats = await new SupportService().adminStats(undefined, {
    id: String(u._id), role: u.role as any,
    categoryScope: (view.department ?? undefined) as any,
    organizationId: view.org,
  })
  return stats.unread
}

const permissionsEnforced = () => {
  const raw = process.env['PERMISSIONS_MODE']
  return raw !== 'report' && raw !== 'off'
}

export async function pendingForPortal(): Promise<{ kinds: PendingKind[]; people: PendingPerson[] }> {
  const staff = await UserModel.find({ role: { $in: [...ADMIN_ROLES, 'instructor'] } })
    .select('name email role isActive organizationId program customRoleId').lean<Staff[]>()

  /* Custom roles that may not list support tickets — only matters while permissions are enforced. */
  const noSupport = new Set<string>()
  if (permissionsEnforced()) {
    const ids = [...new Set(staff.filter(s => s.customRoleId && s.role !== 'super_admin').map(s => String(s.customRoleId)))]
    const roles = ids.length ? await RoleModel.find({ _id: { $in: ids } }).select('permissions').lean() : []
    const found = new Map(roles.map(r => [String(r._id), r]))
    for (const id of ids) {
      const entry = (found.get(id) as { permissions?: Array<Record<string, unknown>> } | undefined)?.permissions?.find(p => p['resource'] === 'support')
      if (entry?.['list'] !== true) noSupport.add(id)   // a dangling role is refused too, as requirePermission does
    }
  }

  /* One count per distinct view, however many accounts share it. */
  const memo = new Map<string, Promise<number>>()
  const once = (key: string, fn: () => Promise<number>) => {
    if (!memo.has(key)) memo.set(key, fn())
    return memo.get(key)!
  }

  const counts = new Map<string, Record<string, number>>()
  const add = (u: Staff, key: string, n: number) => {
    if (!n) return
    const id = String(u._id)
    const c = counts.get(id) ?? {}
    c[key] = (c[key] ?? 0) + n
    counts.set(id, c)
  }

  /* Shared kinds: active admin-side staff, each with their own badge. */
  const admins = staff.filter(s => ADMIN_ROLES.includes(s.role) && s.isActive !== false)
  await Promise.all(admins.map(async u => {
    const view = viewOf(u)
    const sig = `${view.org ?? '*'}|${view.department === undefined ? '*' : view.department ?? 'none'}`
    add(u, 'enrolment_requests', await once(`req|${sig}`, () => pendingRequestsFor(u, view)))
    if (!(u.customRoleId && u.role !== 'super_admin' && noSupport.has(String(u.customRoleId)))) {
      add(u, 'support_tickets', await once(`sup|${sig}`, () => unreadTicketsFor(u, view)))
    }
  }))
  const superView = { org: undefined, department: undefined }
  const ghost = { _id: new Types.ObjectId(), role: 'super_admin' } as Staff
  const [requestsTotal, ticketsTotal] = await Promise.all([
    once('req|*|*', () => pendingRequestsFor(ghost, superView)),
    once('sup|*|*', () => unreadTicketsFor(ghost, superView)),
  ])

  /* Mentors' unread chat, each against its mentor. */
  const unread = await ChatConversationModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { instructorUnread: { $gt: 0 } } },
    { $group: { _id: '$instructorId', n: { $sum: '$instructorUnread' } } },
  ])
  const byId = new Map(staff.map(s => [String(s._id), s]))
  let chatTotal = 0
  for (const row of unread) {
    chatTotal += row.n
    const u = byId.get(String(row._id))
    if (u) add(u, 'chat_messages', row.n)
  }

  const kinds: PendingKind[] = [
    { key: 'enrolment_requests', label: 'Requests', total: requestsTotal, shared: true },
    { key: 'support_tickets', label: 'Support', total: ticketsTotal, shared: true },
    { key: 'chat_messages', label: 'Messages', total: chatTotal },
  ]

  const people: PendingPerson[] = []
  for (const [id, c] of counts) {
    const u = byId.get(id)!
    const total = Object.entries(c).filter(([k]) => !k.endsWith('_overdue')).reduce((s, [, n]) => s + n, 0)
    if (!total) continue
    people.push({ id, name: u.name ?? '', email: String(u.email ?? '').toLowerCase(), active: u.isActive !== false, counts: c, total })
  }
  people.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return { kinds, people }
}
