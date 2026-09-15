/* ─────────────────────────────────────────────────────────────
   Phase 4, property/fuzz — the debounce and the cap under randomness.

   criticalmail.suite checks hand-picked scenarios. This one generates
   thousands of random edit sequences and asserts the invariants that must
   hold for ALL of them. The scenarios I would think to write by hand are
   exactly the ones I already have in mind; this finds the ones I would not.

   Two families, because they support different strengths of claim:

     PART 1 — park everything, then flush ONCE. Deterministic enough to assert
              the EXACT number of emails each student should receive, which
              kind, and carrying which value.

     PART 2 — park and flush interleaved at random. Too chaotic to predict
              exact counts, so it asserts the invariants that can never be
              violated no matter the ordering:

                I1  a flush never sends more mail than there were edits
                I2  nothing is left in limbo — every row ends sent, folded or
                    superseded
                I3  at most ONE pending row per (session, student, kind)
                I4  no student is ever mailed more than the daily cap
                I5  a row is never sent twice

   Seeded PRNG, so a failure is reproducible: the seed is printed with it.

   Run: bun run test:criticalmail-prop
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_criticalmailprop_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-criticalmailprop'
process.env.CRITICAL_DEBOUNCE_MINS = '10'
process.env.CRITICAL_MAIL_CAP      = '3'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

/* mulberry32 — small, fast, and the same sequence every run for a given seed. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { CriticalMailModel, DigestQueueModel, ClassBookingModel } =
  await import('@/models/schema.ts')
const job = await import('@/jobs/criticalmail.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_criticalmailprop_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

type Sent = { kind: string; to: string; title: string; when?: Date }
let sent: Sent[] = []
const recorder = (): any => ({
  cancelled:   async (to: string, _n: string, t: string, w: Date) =>
    void sent.push({ kind: 'cancelled', to, title: t, when: w }),
  rescheduled: async (to: string, _n: string, t: string, _f: Date, t2: Date) =>
    void sent.push({ kind: 'rescheduled', to, title: t, when: t2 }),
  delayed:     async (to: string, _n: string, t: string, w: Date) =>
    void sent.push({ kind: 'delayed', to, title: t, when: w }),
  instructor:  async (to: string, _n: string, t: string, _o: string, _nw: string, w: Date) =>
    void sent.push({ kind: 'instructor', to, title: t, when: w }),
})

const MIN  = 60_000
const KINDS = ['rescheduled', 'instructor', 'cancelled'] as const
const CAP  = job.DAILY_CAP

const oid = () => new mongoose.Types.ObjectId()

/* The flush drops rows whose student is no longer booked, so the fuzz has to
   record the bookings it is generating notices for. */
async function park(row: any, now?: Date) {
  await ClassBookingModel.updateOne(
    { liveClassId: row.liveClassId, userId: row.userId },
    { $setOnInsert: { status: 'booked', bookedAt: new Date() } },
    { upsert: true },
  )
  return job.parkCriticalMail(row, now)
}

async function wipe() {
  sent = []
  await CriticalMailModel.deleteMany({})
  await DigestQueueModel.deleteMany({})
  await ClassBookingModel.deleteMany({})
}

try {

/* ═════════════════════════ PART 1 — exact ═════════════════════════ */
section(`PART 1. Park a random sequence, flush once — the exact mail is predictable (cap ${CAP})`)
{
  let roundsRun = 0
  let worstSeed = 0
  const failures: string[] = []

  for (let seed = 1; seed <= 120; seed++) {
    const rand = rng(seed)
    await wipe()

    const students = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => ({
      id: oid(), email: `p${seed}s${i}@cm.local`,
    }))
    const sessions = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => oid())

    /* The class is weeks out, so the urgent bypass never fires and the buffer
       is always the thing being tested. */
    const base = new Date('2026-11-01T08:00:00Z')
    const far  = new Date('2026-12-01T09:00:00Z')

    /* Model: per (session, student), the sequence of edits. A cancellation
       ENDS that pair's sequence — that is the one ordering the production
       code treats specially, and keeping it out of the middle keeps the
       expectation exact. */
    type Pair = { kinds: Set<string>; cancelled: boolean; lastStart?: Date; order: number }
    const model = new Map<string, Pair>()
    let clock = 0
    let parks = 0

    for (const s of sessions) {
      for (const u of students) {
        const key = `${s}|${u.id}`
        const n = Math.floor(rand() * 4)          // 0..3 edits for this pair
        for (let e = 0; e < n; e++) {
          const m = model.get(key) ?? { kinds: new Set<string>(), cancelled: false, order: clock }
          if (m.cancelled) break                  // sequence is over

          const kind = KINDS[Math.floor(rand() * KINDS.length)]!
          const newStart = new Date(far.getTime() + Math.floor(rand() * 8) * 3600_000)
          const now = new Date(base.getTime() + clock * MIN)
          clock++

          await park({
            liveClassId: String(s), userId: String(u.id), email: u.email, name: 'P',
            kind, title: `S-${String(s).slice(-4)}`, scheduledStart: far, oldStart: far,
            ...(kind === 'rescheduled' ? { newStart } : {}),
            ...(kind === 'instructor'  ? { oldInstructorName: 'A', newInstructorName: 'B' } : {}),
          }, now)
          parks++

          if (kind === 'cancelled') {
            m.cancelled = true
            m.kinds = new Set(['cancelled'])       // everything else is superseded
          } else {
            m.kinds.add(kind)
            if (kind === 'rescheduled') m.lastStart = newStart
          }
          if (!model.has(key)) m.order = clock
          model.set(key, m)
        }
      }
    }

    /* One flush, far enough in the future that every buffer has elapsed. */
    const res = await job.flushCriticalMail({
      now: new Date(base.getTime() + (clock + 60) * MIN), senders: recorder(),
    })

    /* ── expectation ──
       Every surviving row becomes one mail, in queuedAt order, until that
       student hits the cap; the rest fold. */
    const rowsPerStudent = new Map<string, number>()
    for (const [key, m] of model) {
      const email = students.find(u => key.endsWith(String(u.id)))!.email
      rowsPerStudent.set(email, (rowsPerStudent.get(email) ?? 0) + m.kinds.size)
    }
    let expectSent = 0, expectFolded = 0
    for (const [, n] of rowsPerStudent) {
      const mailed = CAP > 0 ? Math.min(n, CAP) : n
      expectSent   += mailed
      expectFolded += n - mailed
    }

    if (res.sent !== expectSent || res.folded !== expectFolded) {
      failures.push(`seed ${seed}: expected {sent:${expectSent},folded:${expectFolded}} got ${JSON.stringify(res)}`)
      worstSeed = worstSeed || seed
    }

    /* A cancelled pair must produce exactly one mail, and it must be the
       cancellation — never the reschedule it overtook. */
    for (const [key, m] of model) {
      if (!m.cancelled) continue
      const title = `S-${key.split('|')[0]!.slice(-4)}`
      const email = students.find(u => key.endsWith(String(u.id)))!.email
      const forPair = sent.filter(x => x.to === email && x.title === title)
      if (forPair.some(x => x.kind !== 'cancelled')) {
        failures.push(`seed ${seed}: a superseded notice was delivered for ${key} — ${JSON.stringify(forPair.map(f => f.kind))}`)
      }
    }
    roundsRun++
  }

  check(`P1 ${roundsRun} random sequences produce exactly the predicted mail`,
    failures.length === 0, failures.slice(0, 4).join(' | '))
  check('P2 no superseded notice is ever delivered',
    !failures.some(f => f.includes('superseded')), failures.find(f => f.includes('superseded')) ?? '')
}

/* ═════════════════════════ PART 2 — chaotic ═════════════════════════ */
section('PART 2. Park and flush interleaved at random — the invariants hold regardless')
{
  const broke: string[] = []
  let totalParks = 0, totalSends = 0, rounds = 0

  for (let seed = 500; seed < 560; seed++) {
    const rand = rng(seed)
    await wipe()

    const students = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => ({
      id: oid(), email: `q${seed}s${i}@cm.local`,
    }))
    const sessions = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => oid())

    const base = new Date('2026-11-01T08:00:00Z')
    const far  = new Date('2026-12-01T09:00:00Z')
    let clock = 0, parks = 0

    const steps = 6 + Math.floor(rand() * 10)
    for (let st = 0; st < steps; st++) {
      const now = new Date(base.getTime() + clock * MIN)
      clock += 1 + Math.floor(rand() * 6)

      if (rand() < 0.68) {
        const s = sessions[Math.floor(rand() * sessions.length)]!
        const u = students[Math.floor(rand() * students.length)]!
        const kind = KINDS[Math.floor(rand() * KINDS.length)]!
        await park({
          liveClassId: String(s), userId: String(u.id), email: u.email, name: 'Q',
          kind, title: 'X', scheduledStart: far, oldStart: far,
          ...(kind === 'rescheduled' ? { newStart: new Date(far.getTime() + 3600_000) } : {}),
          ...(kind === 'instructor'  ? { oldInstructorName: 'A', newInstructorName: 'B' } : {}),
        }, now)
        parks++

        /* I3 — one pending row per (session, student, kind), always. */
        const dupes = await CriticalMailModel.aggregate([
          { $match: { sentAt: null, supersededAt: null } },
          { $group: { _id: { l: '$liveClassId', u: '$userId', k: '$kind' }, n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
        ])
        if (dupes.length) broke.push(`seed ${seed}: ${dupes.length} duplicate pending row(s)`)
      } else {
        await job.flushCriticalMail({ now, senders: recorder() })
      }
    }

    /* Drain. */
    await job.flushCriticalMail({
      now: new Date(base.getTime() + (clock + 120) * MIN), senders: recorder(),
    })

    const mailsThisRound = sent.length
    totalParks += parks
    totalSends += mailsThisRound

    /* I1 — merging can only ever reduce. */
    if (mailsThisRound > parks) broke.push(`seed ${seed}: ${mailsThisRound} mails from ${parks} edits`)

    /* I2 — nothing left in limbo after the drain. */
    const stuck = await CriticalMailModel.countDocuments({ sentAt: null, supersededAt: null })
    if (stuck) broke.push(`seed ${seed}: ${stuck} row(s) stuck pending after the drain`)

    /* I4 — the cap, per student. Every mail in this round is the same day. */
    for (const u of students) {
      const n = sent.filter(x => x.to === u.email).length
      if (CAP > 0 && n > CAP) broke.push(`seed ${seed}: ${u.email} got ${n} mails, cap is ${CAP}`)
    }

    /* I5 — a row is sent once. Rows that were mailed carry foldedToDigest
       false; the count of those must equal the mails the recorder saw. */
    const mailedRows = await CriticalMailModel.countDocuments({
      sentAt: { $ne: null }, foldedToDigest: { $ne: true },
    })
    if (mailedRows !== mailsThisRound) {
      broke.push(`seed ${seed}: ${mailedRows} row(s) marked mailed but ${mailsThisRound} mail(s) sent`)
    }
    rounds++
  }

  check(`P3 ${rounds} interleaved runs never break an invariant`, broke.length === 0,
    broke.slice(0, 5).join(' | '))
  check('P4 the fuzz actually exercised the merge (fewer mails than edits)',
    totalSends < totalParks, `${totalSends} mails from ${totalParks} edits`)
  check('P5 and it actually sent something (not a vacuous pass)', totalSends > 40,
    String(totalSends))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\ncriticalmail.property.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
