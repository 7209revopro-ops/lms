/* ─────────────────────────────────────────────────────────────
   set-sales-crm — a course's sale moved to the sales CRM that really made it
   (the user, 2026-11-24: "this student enrolment by Aparna from Draw, so change
   it on the finance" — closed again in the Sales CRM by somebody else). Finance
   and both CRMs are moved by their own scripts; here only the tag the approval
   put on the student's enrolments (salesCrm), on every enrolment that finance
   invoice opened. Course access, the fee summary and everything else stay.

   Dry run by default — says what it would change. --apply writes, saving an
   undo file in the home folder first.

     bun src/scripts/set-sales-crm.ts --invoice-id <finance invoice id> --crm draw
     bun src/scripts/set-sales-crm.ts --invoice-id <finance invoice id> --crm draw --apply
     bun src/scripts/set-sales-crm.ts --undo <file> [--apply]
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import mongoose, { Types } from 'mongoose'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? String(process.argv[i + 1] ?? '').trim() : '' }
const APPLY = process.argv.includes('--apply')

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }
const host = String(mongoose.connection.host ?? '')
console.log(`LMS database "${mongoose.connection.name}" on ${host}${APPLY ? '' : '  — dry run, nothing is written'}\n`)

try {
  const undo = arg('--undo')
  if (undo) {
    const saved = JSON.parse(fs.readFileSync(undo, 'utf8')) as { invoiceId: string; rows: { id: string; course: string; salesCrm: string | null }[] }
    for (const r of saved.rows) console.log(`  ${r.course}: back to ${r.salesCrm ?? '(no tag)'}`)
    if (!APPLY) { console.log('\nNothing was written. Add --apply to put it back.'); await done(0) }
    for (const r of saved.rows) {
      await M.EnrollmentModel.updateOne({ _id: new Types.ObjectId(r.id) }, r.salesCrm === null ? { $unset: { salesCrm: 1 } } : { $set: { salesCrm: r.salesCrm } })
    }
    console.log('\nDone — put back.')
    await done(0)
  }

  const invoiceId = arg('--invoice-id')
  const crm = arg('--crm').toLowerCase()
  if (!/^[a-f0-9]{24}$/i.test(invoiceId)) throw new Error('Give --invoice-id <the finance invoice id>')
  if (!(M.SALES_CRMS as readonly string[]).includes(crm)) throw new Error(`--crm: one of ${M.SALES_CRMS.join(', ')}`)

  const rows = await M.EnrollmentModel.find({ $or: [{ 'feeSummary.invoiceId': invoiceId }, { 'paymentAccess.invoiceId': invoiceId }] })
    .select('userId courseId salesCrm').populate('courseId', 'title').populate('userId', 'email').lean() as any[]
  if (!rows.length) throw new Error(`No enrolment here came from finance invoice ${invoiceId}`)
  const todo = rows.filter((r) => r.salesCrm !== crm)
  for (const r of rows) console.log(`  ${r.userId?.email ?? '?'} · ${r.courseId?.title ?? r.courseId}: ${r.salesCrm ?? '(no tag)'} → ${crm}${r.salesCrm === crm ? '  (already)' : ''}`)
  if (!todo.length) { console.log('\nNothing to change.'); await done(0) }
  if (!APPLY) { console.log('\nNothing was written. Run again with --apply to do it.'); await done(0) }

  const file = path.join(os.homedir(), `lms-set-sales-crm-undo-${invoiceId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const saved = { invoiceId, rows: todo.map((r) => ({ id: String(r._id), course: String(r.courseId?.title ?? r.courseId), salesCrm: r.salesCrm ?? null })) }
  fs.writeFileSync(file, JSON.stringify(saved, null, 2))
  if (JSON.parse(fs.readFileSync(file, 'utf8')).rows?.length !== todo.length) throw new Error(`The undo file ${file} didn't read back whole — nothing changed`)
  await M.EnrollmentModel.updateMany({ _id: { $in: todo.map((r) => r._id) } }, { $set: { salesCrm: crm } })
  console.log(`\nDone — ${todo.length} enrolment(s) tagged ${crm}.\nUndo file: ${file}\n  bun src/scripts/set-sales-crm.ts --undo ${file} --apply`)
  await done(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  await done(1)
}
