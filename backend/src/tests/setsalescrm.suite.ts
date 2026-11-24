/* ─────────────────────────────────────────────────────────────
   scripts/set-sales-crm.ts, as somebody runs it, against a scratch database
   (the user, 2026-11-24: a Sales CRM close moved to Draw):
     A  the dry run says what changes, writes nothing
     B  --apply: every enrolment that finance invoice opened tagged draw — by the
        fee summary or the payment access — another invoice's untouched; an undo
        file in the home folder; a second run has nothing to change
     C  refusals: no enrolment from that invoice, an unknown CRM, an id that isn't one
     D  the undo puts each tag back (one that had none, without)
   Usage (from backend/): SETSALESCRM_DB_URL=mongodb://127.0.0.1:<port>/lms_setsalescrm bun --no-env-file src/tests/setsalescrm.suite.ts
───────────────────────────────────────────────────────────── */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import mongoose, { Types } from 'mongoose'

const DB = process.env.SETSALESCRM_DB_URL || 'mongodb://127.0.0.1:27017/lms_setsalescrm'
let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const section = (n: string) => console.log(`\n${n}`)
const j = (v: unknown) => String(JSON.stringify(v)).slice(0, 400)

await mongoose.connect(DB)
if (mongoose.connection.db!.databaseName !== 'lms_setsalescrm' || mongoose.connection.host !== '127.0.0.1') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const db = mongoose.connection.db!
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'setsalescrm-'))
const run = async (...args: string[]) => {
  const p = spawnSync('bun', ['--no-env-file', 'src/scripts/set-sales-crm.ts', ...args], {
    env: { PATH: process.env['PATH']!, HOME: home, NODE_ENV: 'test', DATABASE_URL: DB, DOTENV_CONFIG_PATH: path.join(home, 'no.env'),
      JWT_ACCESS_SECRET: 'setsalescrm-access-secret-0123456789abcdef', JWT_REFRESH_SECRET: 'setsalescrm-refresh-secret-0123456789abcdef', ENABLE_CRON: 'false' },
    encoding: 'utf8',
  })
  return { code: p.status, out: `${p.stdout}${p.stderr}` }
}

const INV = '6afdaa00881c31206d95e6aa', OTHER = '6afdaa00881c31206d95e6bb'
const u = new Types.ObjectId(), c1 = new Types.ObjectId(), c2 = new Types.ObjectId(), c3 = new Types.ObjectId()
await db.collection('users').insertOne({ _id: u, email: 'student@e2e.local', name: 'Student' })
await db.collection('courses').insertMany([{ _id: c1, title: 'MBT' }, { _id: c2, title: 'DWT' }, { _id: c3, title: 'Other' }])
const e1 = new Types.ObjectId(), e2 = new Types.ObjectId(), e3 = new Types.ObjectId()
await db.collection('enrollments').insertMany([
  { _id: e1, userId: u, courseId: c1, salesCrm: 'delta', feeSummary: { invoiceId: INV, invoiceNumber: 'IN-00456' }, paymentAccess: { status: 'full', invoiceId: INV } },
  { _id: e2, userId: u, courseId: c2, paymentAccess: { status: 'full', invoiceId: INV } },
  { _id: e3, userId: u, courseId: c3, salesCrm: 'delta', feeSummary: { invoiceId: OTHER, invoiceNumber: 'IN-00999' } },
])
const tags = async () => j((await db.collection('enrollments').find({}).sort({ _id: 1 }).toArray()).map((e) => e.salesCrm ?? null))
const t0 = await tags()

section('A. Dry run')
let r = await run('--invoice-id', INV, '--crm', 'draw')
check('A. says both of the invoice\'s enrolments → draw, nothing written', r.code === 0 && /MBT: delta → draw/.test(r.out) && /DWT: \(no tag\) → draw/.test(r.out) && /dry run/.test(r.out) && (await tags()) === t0, r.out)

section('B. Apply')
r = await run('--invoice-id', INV, '--crm', 'draw', '--apply')
check('B. both of the invoice\'s tagged draw, the other invoice\'s untouched', r.code === 0 && (await tags()) === j(['draw', 'draw', 'delta']), `${r.out} ${await tags()}`)
const file = fs.readdirSync(home).find((f) => f.startsWith(`lms-set-sales-crm-undo-${INV}`))
check('B. an undo file in the home folder', !!file)
const e1now = await db.collection('enrollments').findOne({ _id: e1 })
check('B. the fee summary and access kept', e1now?.feeSummary?.invoiceNumber === 'IN-00456' && e1now?.paymentAccess?.status === 'full', j(e1now))
r = await run('--invoice-id', INV, '--crm', 'draw', '--apply')
check('B. again: nothing to change', r.code === 0 && /Nothing to change/.test(r.out), r.out)

section('C. Refusals')
r = await run('--invoice-id', '6afdaa00881c31206d95e6cc', '--crm', 'draw')
check('C. no enrolment from that invoice', r.code === 1 && /No enrolment here came from finance invoice/.test(r.out), r.out)
r = await run('--invoice-id', INV, '--crm', 'nowhere')
check('C. an unknown CRM', r.code === 1 && /--crm: one of/.test(r.out), r.out)
r = await run('--invoice-id', 'IN-00456', '--crm', 'draw')
check('C. an id that isn\'t one', r.code === 1 && /--invoice-id/.test(r.out), r.out)

section('D. Undo')
r = await run('--undo', path.join(home, file!))
check('D. shown first, nothing written', r.code === 0 && /back to delta/.test(r.out) && /back to \(no tag\)/.test(r.out) && (await tags()) === j(['draw', 'draw', 'delta']), r.out)
r = await run('--undo', path.join(home, file!), '--apply')
check('D. applied: as it was (the untagged one without a tag)', r.code === 0 && (await tags()) === t0, `${r.out} ${await tags()}`)

await db.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
