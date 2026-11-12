/* ─────────────────────────────────────────────────────
   Account merges, both ways with CS Portal (services/csPortalMerge.service.ts,
   /admin/duplicates/cs-portal, /integrations/cs-portal/*; 2026-11-12), over
   HTTP against a real database and a stand-in CS Portal:
     A. the merge pop-up asks CS Portal who the two accounts are there; down:
        said so, the merge still allowed; not linked: said so;
     B. a merge here tells CS Portal — the two accounts, the CS picked, the
        other as Common or not, who — and records what it did; its undo too;
     C. CS Portal down: waiting, tried again once due; refusing: recorded,
        not tried again;
     D. CS Portal merging two students: their accounts merged here, the kept
        one's details, the closed one's email kept — once per CS Portal merge,
        never sent back; found by LMS id or by email; nothing when not two
        accounts; the wrong secret refused; its undo undoes this one, not told
        back; undone here instead, CS Portal is told.
   Run: SUITE_MONGO=mongodb://127.0.0.1:<scratch port> bun --no-env-file src/tests/csportalmerge.suite.ts
───────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = `${process.env.SUITE_MONGO ?? 'mongodb://localhost:27017'}/lms_csportalmerge`
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.OTP_DEV_ECHO = '1'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.JWT_ACCESS_SECRET  ??= 'csportalmerge-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'csportalmerge-suite-refresh-secret-0123456789'
const SECRET = 'csportalmerge-suite-shared-secret-0123456789'

/* ── A stand-in CS Portal ── */
let tcMode: 'up' | 'down' | 'refuse' = 'up'
const tcGot: { path: string; body: any }[] = []
let previewAnswer: Record<string, unknown> = { action: 'nothing', primary: null, secondary: null, sameCs: false }
const tc = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname
    if (req.headers.get('x-lms-secret') !== SECRET) return Response.json({ success: false, error: { message: 'Bad secret' } }, { status: 401 })
    if (tcMode === 'down') return Response.json({ error: { message: 'CS Portal is down' } }, { status: 503 })
    if (tcMode === 'refuse') return Response.json({ success: false, error: { message: 'Those students cannot be merged' } }, { status: 409 })
    const body = await req.json().catch(() => ({}))
    tcGot.push({ path, body })
    if (path === '/api/v1/integrations/lms/merge/preview') return Response.json({ success: true, data: previewAnswer })
    if (path === '/api/v1/integrations/lms/merge') return Response.json({ success: true, data: { action: 'merge', mergeId: 'aaaaaaaaaaaaaaaaaaaaaaaa' } })
    if (path === '/api/v1/integrations/lms/merge/undo') return Response.json({ success: true, data: { undone: true } })
    return Response.json({ error: 'Not found' }, { status: 404 })
  },
})
process.env.COMMISSION_API_URL = `http://127.0.0.1:${tc.port}`
process.env.COMMISSION_S2S_SECRET = SECRET

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const link = await import('@/services/csPortalMerge.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_csportalmerge') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
for (const n of mongoose.modelNames()) await mongoose.model(n).createIndexes().catch(() => {})
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const show = (v: unknown) => JSON.stringify(v).slice(0, 400)
const PW = 'CorrectHorse1'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const make = (o: Record<string, unknown>) => M.UserModel.create({ passwordHash: hash, isActive: true, enrollmentStatus: 'approved', organizationId: org._id, ...o } as never) as Promise<any>
  await make({ name: 'Super', email: 'sa@cpm.local', role: 'super_admin', isVerified: true })
  const pair = async (n: number) => [
    await make({ name: `Kept ${n}`, email: `kept${n}@cpm.local`, role: 'student', isVerified: true, phone: `+97150000${n}000` }),
    await make({ name: `Closed ${n}`, email: `closed${n}@cpm.local`, role: 'student', phone: `050000${n}000` }),
  ]
  const j: Jar = new Map()
  const lr = await call('POST', '/admin/auth/login', { jar: j, body: { email: 'sa@cpm.local', password: PW } })
  if (lr.status !== 200) throw new Error(`login ${why(lr)}`)
  const merge = (k: any, c: any, extra: Record<string, unknown> = {}) =>
    call('POST', '/admin/duplicates/merge', { jar: j, body: { primaryId: String(k._id), secondaryId: String(c._id), confirmEmail: c.email, ...extra } })
  const rec = (id: string) => M.AccountMergeModel.findById(id).lean<any>()

  /* ── A ── */
  section('A. The pop-up asks CS Portal')
  const [k1, c1] = await pair(1)
  previewAnswer = { action: 'merge', primary: { code: 'STU-1', cs: 'Anna', team: 'A', deposits: 0 }, secondary: { code: 'STU-2', cs: 'Ben', team: 'B', deposits: 2 }, sameCs: false }
  let r = await call('POST', '/admin/duplicates/cs-portal', { jar: j, body: { primaryId: String(k1._id), secondaryId: String(c1._id) } })
  const asked = tcGot.find(x => x.path.endsWith('/merge/preview'))
  check('CS Portal is asked with both accounts — LMS id and email', r.status === 200 && asked?.body.primary.lmsUserId === String(k1._id) && asked?.body.primary.email === 'kept1@cpm.local'
    && asked?.body.secondary.lmsUserId === String(c1._id) && asked?.body.secondary.email === 'closed1@cpm.local', show(asked))
  check('…and its answer shown: a merge there, both students with their CS', r.body?.data?.linked === true && r.body.data.action === 'merge' && r.body.data.secondary.cs === 'Ben' && r.body.data.sameCs === false, show(r.body))
  tcMode = 'down'
  r = await call('POST', '/admin/duplicates/cs-portal', { jar: j, body: { primaryId: String(k1._id), secondaryId: String(c1._id) } })
  check('CS Portal down: said so — the merge is still allowed', r.status === 200 && /503|down/i.test(r.body?.data?.unavailable ?? ''), show(r.body))
  tcMode = 'up'
  const savedUrl = process.env.COMMISSION_API_URL
  delete process.env.COMMISSION_API_URL
  r = await call('POST', '/admin/duplicates/cs-portal', { jar: j, body: { primaryId: String(k1._id), secondaryId: String(c1._id) } })
  check('CS Portal not linked: said so', r.body?.data?.linked === false, show(r.body))
  process.env.COMMISSION_API_URL = savedUrl

  /* ── B ── */
  section('B. A merge here tells CS Portal')
  tcGot.length = 0
  r = await merge(k1, c1, { csFrom: 'secondary', otherCsAsCommon: false })
  const told = tcGot.find(x => x.path === '/api/v1/integrations/lms/merge')
  check('merged: CS Portal told — this merge, the two accounts, the CS picked, Common or not, who', r.status === 200 && told?.body.lmsMergeId === r.body?.data?.mergeId
    && told.body.primary.lmsUserId === String(k1._id) && told.body.secondary.email === 'closed1@cpm.local' && told.body.csFrom === 'secondary' && told.body.otherCsAsCommon === false
    && told.body.by.email === 'sa@cpm.local', show(told))
  let m1 = await rec(r.body.data.mergeId)
  check('…recorded: done, with CS Portal\'s merge', m1?.csPortal?.state === 'done' && m1.csPortal.csMergeId === 'aaaaaaaaaaaaaaaaaaaaaaaa' && m1.origin === 'lms' && r.body.data.csPortal?.state === 'done', show(m1?.csPortal))
  const hist = await call('GET', '/admin/duplicates/merges', { jar: j })
  check('…and in Merge history', (hist.body?.data ?? []).some((x: any) => x.id === String(m1._id) && x.csPortal?.state === 'done' && x.origin === 'lms'), show(hist.body?.data?.[0]))
  r = await call('POST', `/admin/duplicates/merges/${m1._id}/undo`, { jar: j })
  check('undone here: CS Portal told to undo its side', r.status === 200 && tcGot.some(x => x.path.endsWith('/merge/undo') && x.body.lmsMergeId === String(m1._id))
    && (await rec(String(m1._id)))?.csPortalUndo?.state === 'done', show(tcGot.map(x => x.path)))
  r = await merge(k1, c1)
  check('no CS picked: the kept account\'s, the other kept as Common (the defaults)', tcGot.at(-1)?.body.csFrom === 'primary' && tcGot.at(-1)?.body.otherCsAsCommon === true, show(tcGot.at(-1)))
  await call('POST', `/admin/duplicates/merges/${r.body.data.mergeId}/undo`, { jar: j })

  /* ── C ── */
  section('C. CS Portal down, or refusing')
  tcMode = 'down'
  r = await merge(k1, c1)
  let mid = r.body?.data?.mergeId
  m1 = await rec(mid)
  check('CS Portal down: the merge here done; CS Portal waiting, with why', r.status === 200 && m1?.status === 'done' && m1?.csPortal?.state === 'pending' && m1.csPortal.attempts === 1 && /503|down/i.test(m1.csPortal.error ?? ''), show(m1?.csPortal))
  check('…not tried again before its time', (await link.drainCsPortalMergesOnce(new Date())).merges === 0)
  tcMode = 'up'
  const later = new Date(Date.now() + 2 * 60 * 60_000)
  check('…tried again once due: done', (await link.drainCsPortalMergesOnce(later)).merges === 1 && (await rec(mid))?.csPortal?.state === 'done')
  tcMode = 'down'
  await call('POST', `/admin/duplicates/merges/${mid}/undo`, { jar: j })
  check('undone while CS Portal is down: its undo waiting', (await rec(mid))?.csPortalUndo?.state === 'pending')
  tcMode = 'up'
  check('…and done once it answers', (await link.drainCsPortalMergesOnce(later)).undos === 1 && (await rec(mid))?.csPortalUndo?.state === 'done')
  tcMode = 'refuse'
  r = await merge(k1, c1)
  mid = r.body?.data?.mergeId
  check('CS Portal refusing: recorded failed with its reason, not tried again', (await rec(mid))?.csPortal?.state === 'failed'
    && /cannot be merged/.test((await rec(mid))?.csPortal?.error ?? '') && (await link.drainCsPortalMergesOnce(later)).merges === 0, show((await rec(mid))?.csPortal))
  tcMode = 'up'
  await call('POST', `/admin/duplicates/merges/${mid}/undo`, { jar: j })

  /* ── D ── */
  section('D. CS Portal merging two students')
  const [k2, c2] = await pair(2)
  const fromTc = (p: string, body: unknown, secret = SECRET) => call('POST', `/integrations/cs-portal${p}`, { body, headers: { 'x-commission-secret': secret } })
  check('the wrong secret: refused', (await fromTc('/merge', { csMergeId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, 'nope')).status === 401)
  check('no secret: refused', (await call('POST', '/integrations/cs-portal/merge', { body: {} })).status === 401)
  tcGot.length = 0
  r = await fromTc('/merge', { csMergeId: 'bbbbbbbbbbbbbbbbbbbbbbbb', primary: { lmsUserId: String(k2._id), email: 'kept2@cpm.local' }, secondary: { email: 'CLOSED2@cpm.local' }, by: { name: 'Mona Manager' } })
  const d = r.body?.data
  const closed2 = await M.UserModel.findById(c2._id).lean<any>()
  const kept2 = await M.UserModel.findById(k2._id).lean<any>()
  check('their accounts merged here — the closed one found by email — into the kept student\'s account', r.status === 200 && d?.action === 'merge' && d.primaryId === String(k2._id)
    && closed2?.isActive === false && String(closed2?.mergedInto) === String(k2._id), show(r.body))
  check('…the kept account\'s own details; the closed one\'s email kept on it', kept2?.name === 'Kept 2' && (kept2?.secondaryEmails ?? []).some((e: any) => (e?.email ?? e) === 'closed2@cpm.local'), show(kept2?.secondaryEmails))
  const m2 = await rec(d.mergeId)
  check('…recorded as asked for by CS Portal, with its merge, by whom', m2?.origin === 'cs_portal' && m2.csPortal?.csMergeId === 'bbbbbbbbbbbbbbbbbbbbbbbb' && /CS Portal · Mona Manager/.test(m2.mergedByEmail ?? ''), show(m2))
  check('…and not sent back to CS Portal', tcGot.length === 0, show(tcGot))
  r = await fromTc('/merge', { csMergeId: 'bbbbbbbbbbbbbbbbbbbbbbbb', primary: { lmsUserId: String(k2._id) }, secondary: { lmsUserId: String(c2._id) } })
  check('the same CS Portal merge again: the same one', r.body?.data?.already === true && (await M.AccountMergeModel.countDocuments({ 'csPortal.csMergeId': 'bbbbbbbbbbbbbbbbbbbbbbbb' })) === 1, show(r.body))
  r = await fromTc('/merge', { csMergeId: 'cccccccccccccccccccccccc', primary: { email: 'nobody@cpm.local' }, secondary: { email: 'kept2@cpm.local' } })
  check('not two accounts here: nothing to do', r.body?.data?.action === 'nothing', show(r.body))
  r = await fromTc('/merge', { primary: {}, secondary: {} })
  check('without its merge id: refused', r.status === 400, why(r))
  r = await fromTc('/merge/undo', { csMergeId: 'bbbbbbbbbbbbbbbbbbbbbbbb' })
  check('CS Portal undid it: undone here, the closed account open again', r.status === 200 && r.body?.data?.undone === true
    && (await M.UserModel.findById(c2._id).lean<any>())?.isActive !== false && !(await M.UserModel.findById(c2._id).lean<any>())?.mergedInto, show(r.body))
  check('…not told back', tcGot.length === 0, show(tcGot))
  r = await fromTc('/merge', { csMergeId: 'dddddddddddddddddddddddd', primary: { lmsUserId: String(k2._id) }, secondary: { lmsUserId: String(c2._id) } })
  const m3 = r.body?.data?.mergeId
  r = await call('POST', `/admin/duplicates/merges/${m3}/undo`, { jar: j })
  check('undone here instead: CS Portal told — by its own merge id', r.status === 200 && tcGot.some(x => x.path.endsWith('/merge/undo') && x.body.csMergeId === 'dddddddddddddddddddddddd'), show(tcGot))
} catch (err) {
  fail++
  lines.push(`  FAIL  suite crashed — ${(err as Error)?.stack ?? err}`)
} finally {
  console.log(lines.join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  server.close()
  tc.stop(true)
  await mongoose.connection.db?.dropDatabase().catch(() => {})
  await mongoose.disconnect()
  process.exit(fail ? 1 : 0)
}
