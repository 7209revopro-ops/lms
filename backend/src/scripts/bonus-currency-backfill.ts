/**
 * bonus-currency-backfill.ts — a sales CRM's bonus with no currency is a
 * US-dollar bonus (the user, 2026-10-12).
 *
 * Closes queued in a sales CRM before it sent the bonus as USD reached finance
 * with no currency, and finance passed the bonus on here in the INVOICE's
 * currency: an enrolment's fee summary says "AED 500" for what was $500 (or,
 * from before finance said any currency, nothing — shown as the fee's). The
 * amounts were always meant as US dollars; nothing is converted, only the
 * label is set.
 *
 * From the list finance's own script writes (finance apps/api/src/scripts/
 * bonus-currency-backfill.ts → backups/bonus-currency/crm-usd-bonus-invoices-*.json:
 * every sales-CRM invoice whose bonus is USD): each enrolment whose fee summary
 * is one of those invoices, bonus given, not labelled USD → USD. An invoice the
 * list gives a corrected amount (finance's --amount: a close whose salesperson
 * typed the AED equivalent — IN-00098's 1,836.50 was $500, the user, 2026-10-12)
 * gets that amount too.
 *
 * A dry run unless told otherwise: it lists what it would change. Before
 * writing it saves an undo file. Safe to run again. Uses DATABASE_URL (Bun
 * reads the .env here, as the API does) unless --uri says otherwise:
 *
 *   bun src/scripts/bonus-currency-backfill.ts --invoices <finance list .json>            # dry run
 *   bun src/scripts/bonus-currency-backfill.ts --invoices <finance list .json> --write    # apply
 *   bun src/scripts/bonus-currency-backfill.ts --undo backups/bonus-currency/undo-<time>.json
 *
 *   --out <dir>   where the undo file goes (default ./backups/bonus-currency)
 */
import fs from 'node:fs'
import path from 'node:path'
import { MongoClient, ObjectId, type Collection } from 'mongodb'

export const CRM_BONUS_CURRENCY = 'USD'

/** A collection that can only be read — what a dry run is given, so it cannot write by mistake. */
export function readOnly(c: Collection): Collection {
  const allowed = new Set(['find', 'findOne', 'countDocuments', 'collectionName'])
  return new Proxy(c, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !allowed.has(prop)) throw new Error(`Dry run: ${prop} is not allowed on ${target.collectionName}`)
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

export interface Target {
  _id: string; invoiceId: string; invoiceNumber: string; amountMinor: number; feeCurrency: string; before?: string
  /** Corrected (finance's --amount): the amount it had. `amountMinor` is then the new one. */
  amountBefore?: number
}

export async function planBonusCurrency(enrollments: Collection, invoiceIds: string[], amounts: Record<string, number> = {}): Promise<Target[]> {
  const ids = [...new Set(invoiceIds.map(String).filter(Boolean))]
  if (!ids.length) return []
  const docs = await enrollments
    .find({
      'feeSummary.invoiceId': { $in: ids },
      'feeSummary.bonus.given': true,
      'feeSummary.bonus.amountMinor': { $gt: 0 },
    }, { projection: { feeSummary: 1 } })
    .sort({ _id: 1 })
    .toArray()
  const out: Target[] = []
  for (const d of docs as any[]) {
    const had = Number(d.feeSummary.bonus.amountMinor) || 0
    const fix = Number(amounts[String(d.feeSummary.invoiceId)]) > 0 ? Math.round(Number(amounts[String(d.feeSummary.invoiceId)])) : undefined
    const wrongAmount = fix !== undefined && fix !== had
    if (d.feeSummary.bonus.currency === CRM_BONUS_CURRENCY && !wrongAmount) continue
    out.push({
      _id: String(d._id),
      invoiceId: String(d.feeSummary.invoiceId),
      invoiceNumber: String(d.feeSummary.invoiceNumber ?? ''),
      amountMinor: wrongAmount ? fix! : had,
      feeCurrency: String(d.feeSummary.currency ?? ''),
      ...(d.feeSummary.bonus.currency !== undefined ? { before: d.feeSummary.bonus.currency } : {}),
      ...(wrongAmount ? { amountBefore: had } : {}),
    })
  }
  return out
}

export async function applyBonusCurrency(enrollments: Collection, plan: Target[]): Promise<number> {
  let n = 0
  for (const t of plan) {
    const res = await enrollments.updateOne(
      t.amountBefore !== undefined
        ? { _id: new ObjectId(t._id), 'feeSummary.bonus.given': true, 'feeSummary.bonus.amountMinor': t.amountBefore }
        : { _id: new ObjectId(t._id), 'feeSummary.bonus.given': true, 'feeSummary.bonus.currency': { $ne: CRM_BONUS_CURRENCY } },
      { $set: { 'feeSummary.bonus.currency': CRM_BONUS_CURRENCY, ...(t.amountBefore !== undefined ? { 'feeSummary.bonus.amountMinor': t.amountMinor } : {}) } },
    )
    n += res.modifiedCount
  }
  return n
}

export interface UndoFile { kind: 'lms-bonus-currency'; at: string; enrollments: Target[] }

/** Puts back what the undo file recorded — only where the label is still the USD this set. */
export async function undoBonusCurrency(enrollments: Collection, undo: UndoFile): Promise<number> {
  if (undo.kind !== 'lms-bonus-currency') throw new Error('Not an LMS bonus-currency undo file')
  let n = 0
  for (const t of undo.enrollments) {
    const res = await enrollments.updateOne(
      { _id: new ObjectId(t._id), 'feeSummary.bonus.currency': CRM_BONUS_CURRENCY },
      {
        ...(t.before === undefined ? { $unset: { 'feeSummary.bonus.currency': '' } } : {}),
        ...(t.before !== undefined || t.amountBefore !== undefined
          ? { $set: { ...(t.before !== undefined ? { 'feeSummary.bonus.currency': t.before } : {}), ...(t.amountBefore !== undefined ? { 'feeSummary.bonus.amountMinor': t.amountBefore } : {}) } }
          : {}),
      },
    )
    n += res.modifiedCount
  }
  return n
}

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
const money = (minor: number, cur: string) => `${cur} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

if (import.meta.main) {
  const write = process.argv.includes('--write')
  const undoPath = arg('--undo')
  const listPath = arg('--invoices')
  const outDir = path.resolve(arg('--out') ?? 'backups/bonus-currency')
  const uri = arg('--uri') ?? process.env.DATABASE_URL ?? ''
  if (!uri) { console.error('No database: set DATABASE_URL or pass --uri'); process.exit(1) }
  if (!undoPath && !listPath) { console.error("Pass --invoices <the list finance's bonus-currency-backfill wrote>"); process.exit(1) }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 })
  await client.connect()
  try {
    const db = client.db()
    const raw = db.collection('enrollments')
    const mutating = write || Boolean(undoPath)
    const enrollments = mutating ? raw : readOnly(raw)
    console.log(`Database "${db.databaseName}"${mutating ? '' : '  — dry run, read only'}\n`)
    if (undoPath) {
      const n = await undoBonusCurrency(enrollments, JSON.parse(fs.readFileSync(undoPath, 'utf8')))
      console.log(`Undone: ${n} enrolment bonus label(s) put back.`)
    } else {
      const list = JSON.parse(fs.readFileSync(listPath!, 'utf8'))
      const invoiceIds: string[] = (list.invoices ?? []).map((i: any) => String(i.invoiceId ?? ''))
      console.log(`${invoiceIds.length} sales-CRM invoice(s) with a USD bonus in finance's list\n`)
      const amounts: Record<string, number> = Object.fromEntries((list.invoices ?? []).filter((i: any) => Number(i.amountMinor) > 0).map((i: any) => [String(i.invoiceId), Number(i.amountMinor)]))
      const plan = await planBonusCurrency(enrollments, invoiceIds, amounts)
      for (const t of plan) console.log(`  ${t.invoiceNumber.padEnd(12)} bonus ${money(t.amountMinor, 'USD').padEnd(14)} was ${t.before ?? `— (shown as the fee's ${t.feeCurrency})`} → USD${t.amountBefore !== undefined ? `, amount corrected from ${(t.amountBefore / 100).toLocaleString('en-US')}` : ''}`)
      console.log(`\n${plan.length} enrolment fee summary bonus(es) ${write ? 'to label' : 'would be labelled'} USD`)
      if (write) {
        if (plan.length) {
          fs.mkdirSync(outDir, { recursive: true })
          const undoFile = path.join(outDir, `undo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
          const undo: UndoFile = { kind: 'lms-bonus-currency', at: new Date().toISOString(), enrollments: plan }
          fs.writeFileSync(undoFile, JSON.stringify(undo, null, 2))
          console.log(`Undo file: ${undoFile}`)
          console.log(`Done: ${await applyBonusCurrency(enrollments, plan)} labelled USD.`)
        } else console.log('Nothing to change.')
      } else console.log('Nothing written. Run again with --write to do it.')
    }
  } finally {
    await client.close()
  }
}
