/* ─────────────────────────────────────────────────────────────
   Mentor KPIs in the LMS admin (the user, 2026-11-09: "show the KPI points
   in the LMS admin too"). Planned, approved and worked out in Root only —
   shown here, view only: an instructor their own month (no ranking); an
   admin or sub-admin their academy's mentors; a super admin every mentor.
   Anyone who may see a mentor may ask Root for a correction to a frozen
   month; a root admin decides there. Root answers only once a root admin has
   opened it ("not open yet" until then) — observation only, not pay.

   Asked of Root with this server's portal link:
     GET  {ROOT_ERP_API_URL}/api/v1/service/mentor-kpis/mentor?email&month
     GET  …/scores?month&emails=a,b
     POST …/corrections                       x-portal-secret: ROOT_ERP_SECRET
───────────────────────────────────────────────────────────── */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const base = (v: unknown) => String(v ?? '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '')
const str = (v: unknown, max = 2000) => String(v ?? '').trim().slice(0, max)
export const kpiMonth = (v: unknown) => (MONTH.test(str(v, 7)) ? str(v, 7) : new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7))

export class KpiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

/** Root's answer, or what to show instead: closed (not opened yet) or missing (not in that month). */
export type KpiAnswer = Record<string, unknown> | { closed: true; message: string } | { missing: true; message: string }

async function callRoot(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<KpiAnswer> {
  const url = base(process.env['ROOT_ERP_API_URL'])
  const secret = String(process.env['ROOT_ERP_SECRET'] ?? '')
  if (!url || !secret) throw new KpiError('The Root portal is not linked to this server (ROOT_ERP_API_URL, ROOT_ERP_SECRET)', 503)
  let res: Response
  try {
    res = await fetch(`${url}/api/v1/service/mentor-kpis${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-portal-secret': secret },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new KpiError('The Root portal could not be reached', 502)
  }
  const body = await res.json().catch(() => ({})) as { data?: Record<string, unknown>; message?: string }
  if (res.ok) return body.data ?? {}
  const message = String(body.message ?? `Root answered ${res.status}`)
  if (res.status === 409 && /aren't open/.test(message)) return { closed: true, message: "Mentor KPIs aren't open yet." }
  if (res.status === 404 && /No such mentor|No approved plan/.test(message)) return { missing: true, message }
  throw new KpiError(message, res.status >= 500 || res.status === 401 ? 502 : res.status)
}

type Viewer = { id: string; email?: string; role: string; organizationId?: unknown }
const TEAM_ROLES = new Set(['super_admin', 'admin', 'sub_admin'])

/** The mentors (instructors) this person may see, by address: their own; an admin their academy's; a super admin all. */
export async function kpiReach(user: Viewer): Promise<{ emails: Set<string>; team: boolean }> {
  const { UserModel } = await import('@/models/schema.ts')
  const own = str(user.email).toLowerCase()
  if (!TEAM_ROLES.has(user.role)) return { emails: new Set(user.role === 'instructor' && own ? [own] : []), team: false }
  const filter: Record<string, unknown> = { role: 'instructor', isActive: { $ne: false } }
  if (user.role !== 'super_admin') {
    if (!user.organizationId) return { emails: new Set(), team: true }
    filter['organizationId'] = user.organizationId
  }
  const people = await UserModel.find(filter, { email: 1 }).lean() as { email?: string }[]
  return { emails: new Set(people.map(p => str(p.email).toLowerCase()).filter(e => e.includes('@'))), team: true }
}

/** An instructor's own month. */
export async function myKpis(user: Viewer, month: unknown) {
  if (user.role !== 'instructor' || !str(user.email).includes('@')) throw new KpiError('My KPIs are for mentors', 403)
  return callRoot(`/mentor?${new URLSearchParams({ email: str(user.email).toLowerCase(), month: kpiMonth(month) })}`)
}

/** The mentors an admin may see, for a month (A–Z, no ranking). */
export async function teamKpis(user: Viewer, month: unknown) {
  const reach = await kpiReach(user)
  if (!reach.team) throw new KpiError("The mentors' KPIs are for admins", 403)
  const m = kpiMonth(month)
  if (!reach.emails.size) return { month: m, mentors: [] }
  return callRoot(`/scores?${new URLSearchParams({ month: m, emails: [...reach.emails].join(',') })}`)
}

/** One mentor within reach. */
export async function mentorKpis(user: Viewer, email: unknown, month: unknown) {
  const who = str(email, 200).toLowerCase()
  if (!(await kpiReach(user)).emails.has(who)) throw new KpiError("That mentor isn't yours to see", 403)
  return callRoot(`/mentor?${new URLSearchParams({ email: who, month: kpiMonth(month) })}`)
}

/** Ask Root for a correction to a frozen month — for a mentor within reach; a root admin decides in Root. */
export async function askKpiCorrection(user: Viewer & { name?: string }, body: Record<string, unknown>) {
  const email = str(body['email'], 200).toLowerCase()
  if (!(await kpiReach(user)).emails.has(email)) throw new KpiError("That mentor isn't yours to ask for", 403)
  const month = str(body['month'], 7)
  if (!MONTH.test(month)) throw new KpiError('Which month?', 400)
  const action = str(body['action'], 20)
  if (action !== 'set_value' && action !== 'leave_out') throw new KpiError('The right value, or leave it out', 400)
  const value = action === 'set_value' ? Number(body['value']) : null
  if (action === 'set_value' && (!Number.isFinite(value) || (value as number) < 0)) throw new KpiError('Give the right value (0 or more)', 400)
  const reason = str(body['reason'], 500)
  if (!reason) throw new KpiError("Say why it's wrong", 400)
  const { UserModel } = await import('@/models/schema.ts')
  const me = await UserModel.findById(user.id, { name: 1, email: 1 }).lean() as { name?: string; email?: string } | null
  return callRoot('/corrections', {
    method: 'POST',
    body: {
      month, email, metric: str(body['metric'], 60), action, value, reason, evidence: str(body['evidence'], 2000),
      raisedBy: { email: str(me?.email ?? user.email).toLowerCase(), name: str(me?.name ?? '') },
    },
  })
}
