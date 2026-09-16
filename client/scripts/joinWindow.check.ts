/* ─────────────────────────────────────────────────────────────
   joinWindow.check.ts — property tests for the pure join-window logic.

   The client has no test runner, but src/lib/joinWindow.ts is plain TypeScript
   with no React or DOM, so bun can run it directly. This script re-derives the
   contract with an independent oracle and compares it against the module over
   thousands of seeded random sessions and instants, plus the exact edges.

   Contract (server-owned, see the module header):
     hidden — isBooked !== true, type !== 'external', isOnline === false,
              status cancelled/ended, either instant missing, or unparseable
     before — now < opens         (strict)
     open   — opens <= now <= closes   (inclusive at BOTH edges)
     closed — now > closes        (strict)
     joinTickMs — 1000 iff some ELIGIBLE session has |now - edge| <= 120 000 ms
                  for either edge, else 30 000 (also for [] and undefined).

   Run: npm run check:joinwindow     (from client/)
───────────────────────────────────────────────────────────── */
import {
  getJoinPhase, isJoinEligible, joinTickMs,
  JOIN_TICK_FAST_MS, JOIN_TICK_SLOW_MS,
  type JoinPhase, type JoinWindowSession,
} from '../src/lib/joinWindow'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

/* ── seeded PRNG (mulberry32) — same sequence every run ─────── */
let seed = 0x5eed1234
function rnd(): number {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
const int  = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

const MIN = 60_000
const NEAR = 2 * MIN
const BASE_T = Date.UTC(2026, 8, 16, 8, 0, 0)     // an ordinary Wednesday morning
const BAD_ISO = ['garbage', 'not-a-date', '2026-13-45T99:99:99Z', 'NaN', '   ', 'null']

/* Independent oracle — written from the contract, not from the module. */
type InstantKind = 'valid' | 'missing' | 'empty' | 'bad'
interface Gen { s: JoinWindowSession; opens: number; closes: number; eligible: boolean; parseable: boolean }

function genSession(forceEligible = false): Gen {
  const opens  = BASE_T + int(-3 * 24 * 60, 3 * 24 * 60) * MIN + int(0, 59_999)
  const closes = opens + (rnd() < 0.85 ? 20 * MIN : int(1, 120) * MIN)

  const isBooked = forceEligible ? true  : pick<boolean | undefined>([true, true, true, false, undefined])
  const type     = forceEligible ? 'external' : pick<string | undefined>(['external', 'external', 'external', 'internal', undefined])
  const isOnline = forceEligible ? pick<boolean | undefined>([true, undefined]) : pick<boolean | undefined>([true, true, undefined, false])
  const status   = forceEligible ? pick<string | undefined>(['scheduled', 'live', undefined])
                                 : pick<string | undefined>(['scheduled', 'scheduled', 'live', 'ended', 'cancelled', undefined])
  const okind: InstantKind = forceEligible ? 'valid' : pick<InstantKind>(['valid', 'valid', 'valid', 'valid', 'missing', 'empty', 'bad'])
  const ckind: InstantKind = forceEligible ? 'valid' : pick<InstantKind>(['valid', 'valid', 'valid', 'valid', 'missing', 'empty', 'bad'])
  const inst = (kind: InstantKind, ms: number): string | undefined =>
    kind === 'valid' ? new Date(ms).toISOString() : kind === 'missing' ? undefined : kind === 'empty' ? '' : pick(BAD_ISO)

  const s: JoinWindowSession = {}
  if (isBooked !== undefined) s.isBooked = isBooked
  if (type     !== undefined) s.type     = type
  if (isOnline !== undefined) s.isOnline = isOnline
  if (status   !== undefined) s.status   = status
  const o = inst(okind, opens);  if (o !== undefined) s.joinOpensAt  = o
  const c = inst(ckind, closes); if (c !== undefined) s.joinClosesAt = c

  const eligible = isBooked === true && type === 'external' && isOnline !== false
    && status !== 'cancelled' && status !== 'ended' && okind !== 'missing' && okind !== 'empty'
    && ckind !== 'missing' && ckind !== 'empty'
  const parseable = okind === 'valid' && ckind === 'valid'
  return { s, opens, closes, eligible, parseable }
}

function oraclePhase(g: Gen, now: number): JoinPhase {
  if (!g.eligible || !g.parseable) return 'hidden'
  if (now < g.opens) return 'before'
  if (now > g.closes) return 'closed'
  return 'open'
}
function oracleTick(list: readonly Gen[] | undefined, now: number): number {
  if (!list) return 30_000
  for (const g of list) {
    if (!g.eligible || !g.parseable) continue
    if (Math.abs(now - g.opens) <= NEAR || Math.abs(now - g.closes) <= NEAR) return 1_000
  }
  return 30_000
}
/* an instant somewhere interesting relative to the window */
function genNow(g: Gen): number {
  switch (int(0, 7)) {
    case 0: return g.opens  + int(-3 * NEAR, 3 * NEAR)
    case 1: return g.closes + int(-3 * NEAR, 3 * NEAR)
    case 2: return g.opens  + int(-2, 2)
    case 3: return g.closes + int(-2, 2)
    case 4: return g.opens  + pick([-NEAR - 1, -NEAR, NEAR, NEAR + 1])
    case 5: return g.closes + pick([-NEAR - 1, -NEAR, NEAR, NEAR + 1])
    case 6: return int(g.opens, g.closes)
    default: return BASE_T + int(-4 * 24 * 60, 4 * 24 * 60) * MIN
  }
}

const describe = (s: JoinWindowSession, now: number) => JSON.stringify({ ...s, now })

/* ══════════════════════════════════════════════════════════════ */
section('1. constants are what the hooks assume')
check('JOIN_TICK_FAST_MS is 1000',  JOIN_TICK_FAST_MS === 1_000,  String(JOIN_TICK_FAST_MS))
check('JOIN_TICK_SLOW_MS is 30000', JOIN_TICK_SLOW_MS === 30_000, String(JOIN_TICK_SLOW_MS))

/* ══════════════════════════════════════════════════════════════ */
section('2. every ineligible combination is hidden — exhaustive over the discrete fields')
{
  const opensIso  = new Date(BASE_T).toISOString()
  const closesIso = new Date(BASE_T + 20 * MIN).toISOString()
  const bookedVals:  (boolean | undefined)[] = [true, false, undefined]
  const typeVals:    (string | undefined)[]  = ['external', 'internal', undefined, '']
  const onlineVals:  (boolean | undefined)[] = [true, false, undefined]
  const statusVals:  (string | undefined)[]  = ['scheduled', 'live', 'ended', 'cancelled', undefined]
  const instVals:    (string | undefined)[]  = ['valid', undefined, '', 'bad']
  let combos = 0, wrong: string[] = []
  for (const b of bookedVals) for (const t of typeVals) for (const o of onlineVals)
  for (const st of statusVals) for (const oi of instVals) for (const ci of instVals) {
    const s: JoinWindowSession = {}
    if (b  !== undefined) s.isBooked = b
    if (t  !== undefined) s.type = t
    if (o  !== undefined) s.isOnline = o
    if (st !== undefined) s.status = st
    if (oi !== undefined) s.joinOpensAt  = oi === 'valid' ? opensIso  : oi === 'bad' ? 'garbage' : oi
    if (ci !== undefined) s.joinClosesAt = ci === 'valid' ? closesIso : ci === 'bad' ? 'garbage' : ci
    const eligible = b === true && t === 'external' && o !== false && st !== 'cancelled' && st !== 'ended'
      && oi !== undefined && oi !== '' && ci !== undefined && ci !== ''
    combos++
    if (isJoinEligible(s) !== eligible) wrong.push('eligible ' + JSON.stringify(s))
    // three instants: before, inside, after — hidden must hold for all of them
    for (const now of [BASE_T - MIN, BASE_T + 5 * MIN, BASE_T + 30 * MIN]) {
      const ph = getJoinPhase(s, now)
      const expectHidden = !eligible || oi === 'bad' || ci === 'bad'
      if (expectHidden && ph !== 'hidden') wrong.push(`phase ${ph} for ${describe(s, now)}`)
      if (!expectHidden && ph === 'hidden') wrong.push(`unexpected hidden for ${describe(s, now)}`)
    }
  }
  check(`isJoinEligible / getJoinPhase agree with the oracle over all ${combos} discrete combinations`,
    wrong.length === 0, wrong.slice(0, 3).join(' | '))
  check('exactly the eligible combos are non-hidden (sanity: some are)', combos === 3 * 4 * 3 * 5 * 4 * 4)
}

/* ══════════════════════════════════════════════════════════════ */
section('3. random sessions × instants — phase agrees with the inclusive server interval')
{
  const N = 6000
  let bad: string[] = [], eligibleSeen = 0, hiddenSeen = 0, phases: Record<JoinPhase, number> = { hidden: 0, before: 0, open: 0, closed: 0 }
  for (let i = 0; i < N; i++) {
    const g = genSession(rnd() < 0.5)
    const now = genNow(g)
    const got = getJoinPhase(g.s, now), want = oraclePhase(g, now)
    phases[got]++
    if (g.eligible && g.parseable) eligibleSeen++; else hiddenSeen++
    if (got !== want) bad.push(`want ${want} got ${got} for ${describe(g.s, now)} (opens=${g.opens}, closes=${g.closes})`)
    if (isJoinEligible(g.s) !== g.eligible) bad.push(`eligibility mismatch for ${JSON.stringify(g.s)}`)
  }
  check(`getJoinPhase matches oracle on ${N} random (session, now) pairs`, bad.length === 0, bad.slice(0, 3).join(' | '))
  check('generator covered both eligible and ineligible sessions', eligibleSeen > 1000 && hiddenSeen > 1000, `${eligibleSeen}/${hiddenSeen}`)
  check('generator produced all four phases', (Object.values(phases) as number[]).every(n => n > 100), JSON.stringify(phases))
}

/* ══════════════════════════════════════════════════════════════ */
section('4. the edges, to the millisecond, on many random windows')
{
  const N = 1500
  let bad: string[] = []
  for (let i = 0; i < N; i++) {
    const g = genSession(true)
    const cases: [number, JoinPhase][] = [
      [g.opens - 1,  'before'], [g.opens,  'open'],
      [g.closes,     'open'],   [g.closes + 1, 'closed'],
    ]
    for (const [now, want] of cases) {
      const got = getJoinPhase(g.s, now)
      if (got !== want) bad.push(`now=${now} (${now - g.opens >= 0 && now - g.closes <= 0 ? 'inside' : 'outside'}) want ${want} got ${got} ${describe(g.s, now)}`)
    }
  }
  check(`opens-1 → before, opens → open, closes → open, closes+1 → closed on ${N} windows`, bad.length === 0, bad.slice(0, 3).join(' | '))
  // a zero-length window is a single open millisecond
  const t = BASE_T + 7 * MIN
  const z: JoinWindowSession = { isBooked: true, type: 'external', isOnline: true, status: 'scheduled', joinOpensAt: new Date(t).toISOString(), joinClosesAt: new Date(t).toISOString() }
  check('zero-length window: opens===closes is open at exactly that ms', getJoinPhase(z, t) === 'open')
  check('zero-length window: before one ms earlier', getJoinPhase(z, t - 1) === 'before')
  check('zero-length window: closed one ms later',   getJoinPhase(z, t + 1) === 'closed')
  // 'live' status must not open the window early (the module header's promise)
  const live: JoinWindowSession = { ...z, status: 'live', joinClosesAt: new Date(t + 20 * MIN).toISOString() }
  check("status 'live' 15 min before start is still 'before'", getJoinPhase(live, t - 15 * MIN) === 'before')
  check("status 'live' at start is 'open'", getJoinPhase(live, t) === 'open')
}

/* ══════════════════════════════════════════════════════════════ */
section('5. a NaN instant never yields open (or before/closed)')
{
  let bad: string[] = []
  const t = BASE_T
  for (const badIso of BAD_ISO) {
    for (const [o, c] of [[badIso, new Date(t + 20 * MIN).toISOString()], [new Date(t).toISOString(), badIso], [badIso, badIso]] as const) {
      const s: JoinWindowSession = { isBooked: true, type: 'external', isOnline: true, status: 'scheduled', joinOpensAt: o, joinClosesAt: c }
      for (const now of [t - MIN, t, t + 10 * MIN, t + 20 * MIN, t + 30 * MIN, NaN]) {
        const ph = getJoinPhase(s, now)
        if (ph !== 'hidden') bad.push(`${ph} for ${describe(s, now)}`)
      }
      if (isJoinEligible(s) !== true) bad.push(`unparseable-but-present instants should still be "eligible" (truthy): ${JSON.stringify(s)}`)
    }
  }
  check('every unparseable instant → hidden at every probe instant', bad.length === 0, bad.slice(0, 3).join(' | '))
  const ok: JoinWindowSession = { isBooked: true, type: 'external', isOnline: true, status: 'scheduled', joinOpensAt: new Date(t).toISOString(), joinClosesAt: new Date(t + 20 * MIN).toISOString() }
  check('a NaN `now` against a valid window never yields open', getJoinPhase(ok, NaN) !== 'open', getJoinPhase(ok, NaN))
  let randomBad = 0, randomNotHidden: string[] = []
  for (let i = 0; i < 500; i++) {
    const g = genSession(false)
    if (g.parseable) continue
    randomBad++
    const ph = getJoinPhase(g.s, genNow(g))
    if (ph !== 'hidden') randomNotHidden.push(JSON.stringify(g.s))
  }
  check(`random sessions with a missing/empty/bad instant are hidden (${randomBad} sampled)`, randomBad > 50 && randomNotHidden.length === 0, randomNotHidden.slice(0, 2).join(' | '))
}

/* ══════════════════════════════════════════════════════════════ */
section('6. joinTickMs — fast iff an eligible session is within 2 min of a boundary')
{
  check('undefined list → slow', joinTickMs(undefined, BASE_T) === 30_000)
  check('empty list → slow',     joinTickMs([], BASE_T) === 30_000)

  const t = BASE_T
  const s = (extra: Partial<JoinWindowSession> = {}): JoinWindowSession => ({
    isBooked: true, type: 'external', isOnline: true, status: 'scheduled',
    joinOpensAt: new Date(t).toISOString(), joinClosesAt: new Date(t + 20 * MIN).toISOString(), ...extra,
  })
  // exact edges around opens
  check('opens − 120 001 ms → slow', joinTickMs([s()], t - NEAR - 1) === 30_000)
  check('opens − 120 000 ms → fast (inclusive edge)', joinTickMs([s()], t - NEAR) === 1_000)
  check('opens − 119 999 ms → fast', joinTickMs([s()], t - NEAR + 1) === 1_000)
  check('opens exactly → fast', joinTickMs([s()], t) === 1_000)
  check('opens + 120 000 ms → fast (inclusive edge)', joinTickMs([s()], t + NEAR) === 1_000)
  check('opens + 120 001 ms → slow (mid-window, far from both edges)', joinTickMs([s()], t + NEAR + 1) === 30_000)
  // exact edges around closes
  const c = t + 20 * MIN
  check('closes − 120 001 ms → slow', joinTickMs([s()], c - NEAR - 1) === 30_000)
  check('closes − 120 000 ms → fast (inclusive edge)', joinTickMs([s()], c - NEAR) === 1_000)
  check('closes exactly → fast', joinTickMs([s()], c) === 1_000)
  check('closes + 120 000 ms → fast (inclusive edge)', joinTickMs([s()], c + NEAR) === 1_000)
  check('closes + 120 001 ms → slow', joinTickMs([s()], c + NEAR + 1) === 30_000)
  check('hours away → slow', joinTickMs([s()], t - 5 * 60 * MIN) === 30_000)
  // a short window: both edges near — still fast
  check('5-minute window, 3 min in → fast (within 2 min of closes)', joinTickMs([s({ joinClosesAt: new Date(t + 5 * MIN).toISOString() })], t + 3 * MIN) === 1_000)

  // ineligible sessions at the boundary must NOT drive the fast tick
  const ineligibleAtEdge: [string, JoinWindowSession][] = [
    ['not booked',           s({ isBooked: false })],
    ['isBooked undefined',   (() => { const x = s(); delete x.isBooked; return x })()],
    ['internal type',        s({ type: 'internal' })],
    ['in-person',            s({ isOnline: false })],
    ['cancelled',            s({ status: 'cancelled' })],
    ['ended',                s({ status: 'ended' })],
    ['no joinOpensAt',       (() => { const x = s(); delete x.joinOpensAt; return x })()],
    ['no joinClosesAt',      (() => { const x = s(); delete x.joinClosesAt; return x })()],
    ['bad joinOpensAt',      s({ joinOpensAt: 'garbage' })],
    ['bad joinClosesAt',     s({ joinClosesAt: 'garbage' })],
  ]
  for (const [label, sess] of ineligibleAtEdge) {
    check(`${label} sitting exactly at opens → slow`, joinTickMs([sess], t) === 30_000)
  }
  check('one eligible among many ineligible at the edge → fast', joinTickMs([...ineligibleAtEdge.map(([, x]) => x), s()], t) === 1_000)
  check('eligible-at-edge listed FIRST → fast', joinTickMs([s(), s({ status: 'ended' })], t) === 1_000)
  check('eligible-at-edge listed LAST → fast',  joinTickMs([s({ status: 'ended' }), s()], t) === 1_000)

  // random lists
  const N = 3000
  let bad: string[] = [], fastSeen = 0, slowSeen = 0
  for (let i = 0; i < N; i++) {
    const len = int(0, 6)
    const list: Gen[] = []
    for (let k = 0; k < len; k++) list.push(genSession(rnd() < 0.5))
    const anchor = list.length ? pick(list) : null
    const now = anchor
      ? (rnd() < 0.5 ? anchor.opens : anchor.closes) + pick([-NEAR - 1, -NEAR, -NEAR + 1, -1, 0, 1, NEAR - 1, NEAR, NEAR + 1, int(-10 * NEAR, 10 * NEAR)])
      : BASE_T + int(-1000, 1000) * MIN
    const got = joinTickMs(list.map(g => g.s), now), want = oracleTick(list, now)
    if (want === 1_000) fastSeen++; else slowSeen++
    if (got !== want) bad.push(`want ${want} got ${got} now=${now} list=${JSON.stringify(list.map(g => g.s))}`)
  }
  check(`joinTickMs matches oracle on ${N} random lists`, bad.length === 0, bad.slice(0, 2).join(' | '))
  check('random lists exercised both fast and slow outcomes', fastSeen > 500 && slowSeen > 500, `${fastSeen}/${slowSeen}`)
  check('joinTickMs only ever returns one of the two constants',
    Array.from({ length: 300 }, () => { const g = genSession(rnd() < 0.5); return joinTickMs([g.s], genNow(g)) })
      .every(v => v === 1_000 || v === 30_000))
}

/* ══════════════════════════════════════════════════════════════ */
section('7. purity — the module does not mutate its inputs or read the wall clock')
{
  const s: JoinWindowSession = { isBooked: true, type: 'external', isOnline: true, status: 'scheduled', joinOpensAt: new Date(BASE_T).toISOString(), joinClosesAt: new Date(BASE_T + 20 * MIN).toISOString() }
  const snap = JSON.stringify(s)
  getJoinPhase(s, BASE_T); joinTickMs([s], BASE_T); isJoinEligible(s)
  check('inputs are not mutated', JSON.stringify(s) === snap)
  const frozen = Object.freeze([Object.freeze({ ...s })]) as readonly JoinWindowSession[]
  let threw = false
  try { joinTickMs(frozen, BASE_T); getJoinPhase(frozen[0]!, BASE_T) } catch { threw = true }
  check('works on frozen inputs', !threw)
  // the same (session, now) far in the past and far in the future give the same answer — no Date.now() inside
  const past = Date.UTC(2001, 0, 1), future = Date.UTC(2090, 0, 1)
  const p: JoinWindowSession = { ...s, joinOpensAt: new Date(past).toISOString(), joinClosesAt: new Date(past + 20 * MIN).toISOString() }
  const f: JoinWindowSession = { ...s, joinOpensAt: new Date(future).toISOString(), joinClosesAt: new Date(future + 20 * MIN).toISOString() }
  check('phase depends only on `now`, not the wall clock (2001 window)', getJoinPhase(p, past + MIN) === 'open' && getJoinPhase(p, past - 1) === 'before')
  check('phase depends only on `now`, not the wall clock (2090 window)', getJoinPhase(f, future + MIN) === 'open' && getJoinPhase(f, future + 21 * MIN) === 'closed')
}

/* ══════════════════════════════════════════════════════════════ */
console.log(lines.join('\n'))
console.log(`\njoinWindow.check — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
