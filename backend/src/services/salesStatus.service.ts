/* ─────────────────────────────────────────────────────
   Where a student stands in sales (the user, 2026-10-13)
   ─────────────────────────────────────────────────────
   Enrollment Requests shows, beside each student, whether a sales CRM has them
   as a lead — which CRM, the salesperson, the lead's status — and where their
   enrolment stands in finance: not raised, waiting for approval, sent back, or
   approved. Two systems answer, each for a page of students at a time:

     Root     POST {ROOT_ERP_API_URL}/api/v1/service/crm-leads
              { people: [{ id, email, phone }] }      x-portal-secret: ROOT_ERP_SECRET
              Root reads every sales CRM (Delta, Banglore, Draw, Remote): a lead
              with the student's email, or a number ending in the same 9 digits.
     Finance  POST {FINANCE_API_URL}/api/v1/lms/enrolment-status
              { emails }                              x-lms-secret: FINANCE_S2S_SECRET
              The enrolments the CRMs sent finance for that email, newest first.

   Read-only on every side. Answers are kept a minute, so paging back and forth
   does not ask again. Either side failing says so on the card — the page and
   the approval buttons do not depend on it.
───────────────────────────────────────────────────── */
import { logger } from '@/utils/logger.ts'

const TIMEOUT_MS = 10_000
const CACHE_MS = 60_000
export const BATCH = 100

export interface CrmLeadMatch {
  crm:         string
  crmName:     string
  leadId:      string
  leadName:    string
  status:      string
  statusLabel: string
  assignedTo:  string
  matchedBy:   'email' | 'phone'
  createdAt:   string | null
}

export interface FinanceEnrolmentRequest {
  invoiceNumber:  string
  crm:            string
  closedBy:       string
  course:         string
  approval:       'pending' | 'approved' | 'returned'
  returnedReason: string
  at:             string
}

/** One side's answer for one student: what it said, or why it couldn't. */
export type Side<T> =
  | ({ state: 'ok' } & T)
  | { state: 'not_configured' | 'unavailable'; message: string }

export interface SalesStatus {
  crm:     Side<{ matches: CrmLeadMatch[] }>
  finance: Side<{ inFinance: boolean; requests: FinanceEnrolmentRequest[] }>
}

export interface Person { id: string; email: string; phone: string }

class SideError extends Error {
  constructor(public state: 'not_configured' | 'unavailable', message: string) { super(message) }
}

const base = (v: unknown) => String(v ?? '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '')
const digits = (v: string) => v.replace(/\D/g, '')

/* ── a minute's memory, per student per side ─────────────────────────── */
const cache = new Map<string, { until: number; value: unknown }>()
function remembered<T>(key: string): T | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (hit.until < Date.now()) { cache.delete(key); return undefined }
  return hit.value as T
}
function remember(key: string, value: unknown) {
  if (cache.size > 5_000) cache.clear()
  cache.set(key, { until: Date.now() + CACHE_MS, value })
}
/** Tests only. */
export function forgetSalesStatus(): void { cache.clear() }

async function post(url: string, headers: Record<string, string>, body: unknown, who: string): Promise<Record<string, unknown>> {
  let res: globalThis.Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new SideError('unavailable', `${who} could not be reached`)
  }
  if (res.status === 404) throw new SideError('unavailable', `${who}'s server is on the previous version — this shows once it is updated`)
  const json = await res.json().catch(() => null) as { data?: Record<string, unknown> } | null
  if (!res.ok || !json?.data) throw new SideError('unavailable', `${who} answered ${res.status}`)
  return json.data
}

/* ── Root: the sales CRMs ───────────────────────────────────────────── */
async function crmLeads(people: Person[]): Promise<Map<string, CrmLeadMatch[]>> {
  const url = base(process.env['ROOT_ERP_API_URL'])
  const secret = String(process.env['ROOT_ERP_SECRET'] ?? '')
  if (!url || !secret) throw new SideError('not_configured', 'The Root portal is not linked to this server (ROOT_ERP_API_URL, ROOT_ERP_SECRET)')
  const out = new Map<string, CrmLeadMatch[]>()
  for (let i = 0; i < people.length; i += BATCH) {
    const chunk = people.slice(i, i + BATCH)
    const data = await post(`${url}/api/v1/service/crm-leads`, { 'x-portal-secret': secret },
      { people: chunk.map(p => ({ id: p.id, ...(p.email ? { email: p.email } : {}), ...(digits(p.phone).length >= 9 ? { phone: p.phone } : {}) })) }, 'Root')
    const results = (data['results'] ?? {}) as Record<string, CrmLeadMatch[]>
    for (const p of chunk) out.set(p.id, Array.isArray(results[p.id]) ? results[p.id]! : [])
  }
  return out
}

/* ── Finance: the enrolments sent there ─────────────────────────────── */
export async function financeStatuses(emails: string[]): Promise<Map<string, { inFinance: boolean; requests: FinanceEnrolmentRequest[] }>> {
  const url = base(process.env['FINANCE_API_URL'])
  const secret = String(process.env['FINANCE_S2S_SECRET'] ?? '')
  if (!url || !secret) throw new SideError('not_configured', 'Finance is not linked to this server (FINANCE_API_URL, FINANCE_S2S_SECRET)')
  const out = new Map<string, { inFinance: boolean; requests: FinanceEnrolmentRequest[] }>()
  const asked: string[] = []
  for (const e of [...new Set(emails.map(x => x.trim().toLowerCase()).filter(x => x.includes('@')))]) {
    const hit = remembered<{ inFinance: boolean; requests: FinanceEnrolmentRequest[] }>(`fin:${e}`)
    if (hit) out.set(e, hit)
    else asked.push(e)
  }
  for (let i = 0; i < asked.length; i += BATCH) {
    const chunk = asked.slice(i, i + BATCH)
    const data = await post(`${url}/api/v1/lms/enrolment-status`, { 'x-lms-secret': secret }, { emails: chunk }, 'Finance')
    const results = (data['results'] ?? {}) as Record<string, { inFinance?: unknown; requests?: unknown }>
    for (const e of chunk) {
      const r = results[e]
      const value = {
        inFinance: r?.inFinance === true,
        requests: Array.isArray(r?.requests) ? r.requests as FinanceEnrolmentRequest[] : [],
      }
      remember(`fin:${e}`, value)
      out.set(e, value)
    }
  }
  return out
}

const failed = (err: unknown): { state: 'not_configured' | 'unavailable'; message: string } =>
  err instanceof SideError ? { state: err.state, message: err.message } : { state: 'unavailable', message: 'Could not check' }

/** Both sides for these students, each answering on its own. Keyed by student id. */
export async function salesStatusFor(people: Person[]): Promise<Record<string, SalesStatus>> {
  const crmKey = (p: Person) => `crm:${p.email}|${digits(p.phone).slice(-9)}`
  const crmAsk = people.filter(p => remembered(crmKey(p)) === undefined)

  const [crm, fin] = await Promise.allSettled([
    crmAsk.length ? crmLeads(crmAsk) : Promise.resolve(new Map<string, CrmLeadMatch[]>()),
    financeStatuses(people.map(p => p.email)),
  ])
  if (crm.status === 'rejected') logger.warn({ err: (crm.reason as Error).message }, 'Sales status: Root could not be asked')
  if (fin.status === 'rejected') logger.warn({ err: (fin.reason as Error).message }, 'Sales status: finance could not be asked')

  const out: Record<string, SalesStatus> = {}
  for (const p of people) {
    let crmSide: SalesStatus['crm']
    const cached = remembered<CrmLeadMatch[]>(crmKey(p))
    if (cached) crmSide = { state: 'ok', matches: cached }
    else if (crm.status === 'fulfilled') {
      const matches = crm.value.get(p.id) ?? []
      remember(crmKey(p), matches)
      crmSide = { state: 'ok', matches }
    } else crmSide = failed(crm.reason)

    const finSide: SalesStatus['finance'] = fin.status === 'fulfilled'
      ? { state: 'ok', ...(fin.value.get(p.email) ?? { inFinance: false, requests: [] }) }
      : failed(fin.reason)
    out[p.id] = { crm: crmSide, finance: finSide }
  }
  return out
}

/** The finance request filter on Enrollment Requests: the newest request's state, or "none" when finance has none. */
export type FinanceRequestFilter = 'none' | 'pending' | 'returned' | 'approved'
export function financeRequestState(requests: FinanceEnrolmentRequest[]): FinanceRequestFilter {
  return requests[0]?.approval ?? 'none'
}

export { SideError as SalesStatusError }
