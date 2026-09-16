/* ─────────────────────────────────────────────────────────────
   Property / fuzz suite for the class-bookings grouping fix.

   The client groups live-class sessions into cards. The bug was: grouping by
   title alone, then labeling the whole card from the earliest slot — so a
   same-title class for a DIFFERENT instructor showed the wrong name. The fix
   keys each group on a composite identity [title|instructor|course|section]
   and keeps the DISPLAY title separate (slots[0].title.trim()).

   This suite ports that exact logic and throws thousands of randomized,
   deliberately nasty session sets at it, asserting invariants that MUST hold
   for the bug to stay fixed and for no new mis-attribution/loss to appear:

     INV1  homogeneity   — every slot in a group shares the same identity tuple
     INV2  instructor    — the group's shown instructor == every slot's own
     INV3  clean title   — group.title === slots[0].title.trim() (no key leak)
     INV4  merge repeats  — identical-identity sessions land in ONE group
     INV5  partition     — every input appears exactly once across all groups
     INV6  unique ids     — distinct groups have distinct ids
     INV7  ordering       — slots within a group are ascending by start
     INV8  split needed   — sessions differing ONLY by instructor never merge

   Pure logic, no DB, no server. Run: bun src/tests/instructormismatch.property.suite.ts
───────────────────────────────────────────────────────────── */
export {}

let pass = 0, fail = 0
const fails: string[] = []
function ok(cond: boolean, msg: () => string) { if (cond) pass++; else { fail++; if (fails.length < 25) fails.push(msg()) } }

/* ── Ported verbatim from client/src/app/(dashboard)/class-bookings/page.tsx ── */
type Sec = string | { id: string; title?: string } | undefined
type Slot = {
  id: string; title: string; scheduledStart: string
  instructor: { id: string; name: string } | null
  course?: { id: string } ; sectionId?: Sec
}
const secKey = (lc: Slot) => { const s = lc.sectionId; return typeof s === 'object' && s ? s.id : s ?? '' }
const keyOf  = (lc: Slot) => [lc.title.trim(), lc.instructor?.id ?? '', lc.course?.id ?? '', secKey(lc)].join('|')
type Group = { id: string; title: string; instructor: Slot['instructor']; slots: Slot[] }
function groupFixed(classes: Slot[]): Group[] {
  const map = new Map<string, Slot[]>()
  classes.forEach(lc => { const k = keyOf(lc); if (!map.has(k)) map.set(k, []); map.get(k)!.push(lc) })
  const res: Group[] = []
  map.forEach((slots, id) => {
    slots.sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
    res.push({ id, title: slots[0]!.title.trim(), instructor: slots[0]!.instructor ?? null, slots })
  })
  return res
}

/* ── Seeded RNG (mulberry32) — deterministic, reproducible failures. ── */
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* Deliberately adversarial value pools: whitespace, case, empty, and a title
   containing the composite delimiter '|' to probe key-collision. */
const TITLES = ['Market Breakout', ' Market Breakout ', 'market breakout', 'Q&A', 'Weekly Live Session', 'A|B', 'A', '', '  ', 'Live']
const INSTR  = [null, { id: 'i1', name: 'Alice' }, { id: 'i2', name: 'Bob' }, { id: 'i3', name: 'Carol' }, { id: 'B', name: 'EdgeB' }]
const COURSE: (Slot['course'])[] = [undefined, { id: 'c1' }, { id: 'c2' }, { id: 'B' }]
const SECS:  Sec[] = [undefined, 's1', 's2', { id: 's1', title: 'M1' }, { id: 'B' }]

function pick<T>(r: () => number, arr: T[]): T { return arr[Math.floor(r() * arr.length)]! }

const SEED = process.argv[2] ? Number(process.argv[2]) : 0xC0FFEE
const RUNS = process.argv[3] ? Number(process.argv[3]) : 12000
const rnd = mulberry32(SEED)
let checked = 0

for (let n = 0; n < RUNS; n++) {
  const count = 1 + Math.floor(rnd() * 7)
  const classes: Slot[] = []
  for (let i = 0; i < count; i++) {
    classes.push({
      id: `${n}-${i}`,
      title: pick(rnd, TITLES),
      instructor: pick(rnd, INSTR),
      course: pick(rnd, COURSE),
      sectionId: pick(rnd, SECS),
      scheduledStart: new Date(1_700_000_000_000 + Math.floor(rnd() * 5) * 3_600_000).toISOString(),
    })
  }
  const groups = groupFixed(classes)
  checked++

  // INV1 + INV2 + INV3 + INV7 — per group
  for (const g of groups) {
    const k0 = keyOf(g.slots[0]!)
    const homog = g.slots.every(s => keyOf(s) === k0)
    ok(homog, () => `INV1 run#${n} group ${JSON.stringify(g.id)} not homogeneous: ${g.slots.map(keyOf).join(' , ')}`)

    const gid = g.instructor?.id ?? ''
    const instrOk = g.slots.every(s => (s.instructor?.id ?? '') === gid)
    ok(instrOk, () => `INV2 run#${n} group ${JSON.stringify(g.id)} shows instr '${gid}' but slots are ${g.slots.map(s => s.instructor?.id ?? '∅').join(',')}`)

    ok(g.title === g.slots[0]!.title.trim(), () => `INV3 run#${n} title '${g.title}' != slots[0] '${g.slots[0]!.title.trim()}'`)

    let ordered = true
    for (let i = 1; i < g.slots.length; i++) if (new Date(g.slots[i]!.scheduledStart) < new Date(g.slots[i - 1]!.scheduledStart)) ordered = false
    ok(ordered, () => `INV7 run#${n} group ${JSON.stringify(g.id)} slots not ascending`)
  }

  // INV5 — partition: every input appears exactly once
  const seenIds = new Set<string>()
  let dup = false
  for (const g of groups) for (const s of g.slots) { if (seenIds.has(s.id)) dup = true; seenIds.add(s.id) }
  ok(!dup && seenIds.size === classes.length,
     () => `INV5 run#${n} partition broken: in=${classes.length} out=${seenIds.size} dup=${dup}`)

  // INV6 — distinct group ids
  const ids = groups.map(g => g.id)
  ok(new Set(ids).size === ids.length, () => `INV6 run#${n} duplicate group ids: ${ids.join(' | ')}`)

  // INV8 — sessions identical in every identity field EXCEPT instructor must not merge
  //        (verified structurally: any two slots in the same group have equal instructor id)
  for (const g of groups) {
    const bad = g.slots.some(s => (s.instructor?.id ?? '') !== gidOf(g))
    ok(!bad, () => `INV8 run#${n} a group merged differing instructors`)
  }
}
function gidOf(g: Group) { return g.instructor?.id ?? '' }

// INV4 — targeted: identical-identity sessions ALWAYS merge; instructor-only diff NEVER merges.
{
  const base = (over: Partial<Slot>): Slot => ({ id: 'x', title: 'Series', instructor: { id: 'i1', name: 'A' }, course: { id: 'c1' }, sectionId: 's1', scheduledStart: '2026-01-01T10:00:00.000Z', ...over })
  const twinA = base({ id: 'a', scheduledStart: '2026-01-01T10:00:00.000Z' })
  const twinB = base({ id: 'b', scheduledStart: '2026-01-08T10:00:00.000Z' })   // weekly repeat, identical identity
  const merged = groupFixed([twinA, twinB])
  ok(merged.length === 1 && merged[0]!.slots.length === 2, () => `INV4 identical-identity should merge, got ${merged.length} groups`)

  const diffInstr = groupFixed([base({ id: 'a', instructor: { id: 'i1', name: 'A' } }), base({ id: 'b', instructor: { id: 'i2', name: 'B' } })])
  ok(diffInstr.length === 2, () => `INV8 instructor-only diff should split, got ${diffInstr.length} groups`)

  const diffCourse = groupFixed([base({ id: 'a', course: { id: 'c1' } }), base({ id: 'b', course: { id: 'c2' } })])
  ok(diffCourse.length === 2, () => `course-only diff should split, got ${diffCourse.length}`)

  const diffSec = groupFixed([base({ id: 'a', sectionId: 's1' }), base({ id: 'b', sectionId: { id: 's2' } })])
  ok(diffSec.length === 2, () => `section-only diff should split, got ${diffSec.length}`)

  const noInstr = groupFixed([base({ id: 'a', instructor: null }), base({ id: 'b', instructor: null })])
  ok(noInstr.length === 1, () => `two no-instructor same-identity should merge, got ${noInstr.length}`)
}

/* ── Modal disambiguation (ports openGroup: groups.find(g=>g.id===openKey.id)).
   Two cards with the SAME displayed title but different course/module must
   resolve, on click, to the CLICKED group — never silently to the first.
   This is the exact "wrong card opens" failure the id-threading prevents. ── */
{
  const resolve = (groups: Group[], id: string) => groups.find(g => g.id === id) ?? null
  const mk = (id: string, over: Partial<Slot>): Slot => ({ id, title: 'Advanced Forex', instructor: { id: 'i1', name: 'A' }, course: { id: 'c1' }, sectionId: 's1', scheduledStart: '2026-05-01T10:00:00.000Z', ...over })

  // same title + instructor + section, DIFFERENT course → two look-alike cards
  const byCourse = groupFixed([mk('p', { course: { id: 'c1' } }), mk('q', { course: { id: 'c2' } })])
  ok(byCourse.length === 2, () => `different-course same-title should be 2 cards, got ${byCourse.length}`)
  ok(byCourse[0]!.title === byCourse[1]!.title, () => `the two cards must share the DISPLAY title`)
  ok(byCourse[0]!.id !== byCourse[1]!.id, () => `the two cards must have DISTINCT ids (React keys)`)
  const g1 = byCourse.find(g => g.slots.some(s => s.id === 'q'))!   // the "second" card
  const opened = resolve(byCourse, g1.id)
  ok(opened === g1 && opened!.slots[0]!.course!.id === g1.slots[0]!.course!.id,
     () => `clicking the second card must open the second group, not the first`)
  const g0 = byCourse.find(g => g.slots.some(s => s.id === 'p'))!
  ok(resolve(byCourse, g0.id) === g0, () => `clicking the first card must open the first group`)

  // same title + instructor + course, DIFFERENT module (section) → also two cards
  const bySection = groupFixed([mk('p', { sectionId: 's1' }), mk('q', { sectionId: { id: 's2' } })])
  ok(bySection.length === 2, () => `different-module same-title should be 2 cards, got ${bySection.length}`)
  const target = bySection.find(g => g.slots.some(s => s.id === 'q'))!
  ok(resolve(bySection, target.id) === target, () => `module disambiguation must resolve to the clicked group`)

  // a stale/removed id (group left the section on a refetch) resolves to null → modal closes cleanly
  ok(resolve(byCourse, 'no-such-id|x|y|z') === null, () => `a stale group id must resolve to null (modal unmounts safely)`)
}

console.log(`\ninstructormismatch.property.suite — ${pass} passed, ${fail} failed  (${checked} fuzz runs, seed=${SEED})`)
if (fails.length) { console.log('\nFirst failures:'); for (const f of fails) console.log('  FAIL  ' + f) }
process.exit(fail === 0 ? 0 : 1)
