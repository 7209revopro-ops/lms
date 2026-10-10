/* ─────────────────────────────────────────────────────────────
   Shared by the Email Logs and WhatsApp Logs pages: the date-range filter
   and the sent / failed / pending summary. Days are Dubai days, like every
   other day boundary on the server.
───────────────────────────────────────────────────────────── */
import type { Model } from 'mongoose'
import { zoneDateKey, zoneDayBounds, addDaysToDateKey } from '@/utils/zoneDay.ts'

const ZONE = 'Asia/Dubai'
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/** createdAt between two YYYY-MM-DD days (inclusive), either end optional. */
export function createdBetween(from?: unknown, to?: unknown): Record<string, unknown> | null {
  const f = typeof from === 'string' && DAY_KEY.test(from) ? zoneDayBounds(from, ZONE).start : null
  const t = typeof to === 'string' && DAY_KEY.test(to) ? zoneDayBounds(to, ZONE).end : null
  if (!f && !t) return null
  return { createdAt: { ...(f ? { $gte: f } : {}), ...(t ? { $lt: t } : {}) } }
}

export interface StatusCounts { sent: number; failed: number; pending: number; total: number }

async function countsSince(model: Model<any>, since: Date): Promise<StatusCounts> {
  const rows = await model.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
  const c: StatusCounts = { sent: 0, failed: 0, pending: 0, total: 0 }
  for (const r of rows as Array<{ _id: string; n: number }>) {
    if (r._id === 'sent' || r._id === 'failed' || r._id === 'pending') c[r._id] = r.n
    c.total += r.n
  }
  return c
}

/** Today (Dubai) and the last 7 days, by status. */
export async function outboxSummary(model: Model<any>): Promise<{ today: StatusCounts; last7Days: StatusCounts }> {
  const today = zoneDateKey(new Date(), ZONE)
  const [t, w] = await Promise.all([
    countsSince(model, zoneDayBounds(today, ZONE).start),
    countsSince(model, zoneDayBounds(addDaysToDateKey(today, -6), ZONE).start),
  ])
  return { today: t, last7Days: w }
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
