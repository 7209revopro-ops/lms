/* ─────────────────────────────────────────────────────
   check-seat-writes — fail the build if anything but seatPool.service.ts
   moves a live class's seat counter.

   A class serving two academies divides its seats into per-academy floors plus
   a shared overflow. Every reservation has to decrement the RIGHT pool, and
   every release has to return the seat to the pool it came from. There are
   twelve reserve and release sites; a thirteenth written later as a plain
   `$inc: { bookedCount: 1 }` would take a seat from nobody's floor and give it
   back to nobody's, and the only symptom is an academy quietly losing seats it
   was promised. There is no error, no log line, and no way to tell afterwards
   which booking caused it.

   So the rule is mechanical and so is the check.

   Run: bun run check:seats
───────────────────────────────────────────────────── */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/* Run from backend/, the way every other script in this folder is. */
const SRC    = resolve(process.cwd(), 'src')
const ALLOWED = join('services', 'seatPool.service.ts')

/* Tests legitimately assert on the counter and seed fixtures with it. */
const SKIP_DIRS = new Set(['tests', 'node_modules'])

const PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\$inc\s*:\s*\{[^}]*\bbookedCount\b/,            what: '$inc on bookedCount' },
  { re: /\$inc\s*:\s*\{[^}]*\bhostSeatsLeft\b/,          what: '$inc on hostSeatsLeft' },
  { re: /\$inc\s*:\s*\{[^}]*\boverflowSeatsLeft\b/,      what: '$inc on overflowSeatsLeft' },
  { re: /\$inc\s*:\s*\{[^}]*guestCohorts[^}]*seatsLeft/, what: '$inc on a cohort seatsLeft' },
]

const offences: string[] = []

function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full)
      continue
    }
    if (!entry.endsWith('.ts')) continue

    const rel = relative(SRC, full)
    if (rel === ALLOWED || rel === ALLOWED.split(sep).join('/')) continue
    /* The reconciler rewrites the counters wholesale with $set, by design. */
    if (rel.endsWith('reconcile-class-seats.ts')) continue
    /* This file quotes the forbidden pattern in order to describe it. */
    if (rel.endsWith('check-seat-writes.ts')) continue

    const text = readFileSync(full, 'utf8')
    text.split('\n').forEach((line, i) => {
      for (const p of PATTERNS) {
        if (p.re.test(line)) offences.push(`  ${rel}:${i + 1}  ${p.what}\n      ${line.trim()}`)
      }
    })
  }
}

walk(SRC)

if (offences.length) {
  console.error('Seat counters may only be moved by services/seatPool.service.ts.\n')
  console.error(offences.join('\n'))
  console.error(`\n${offences.length} offending line(s). Use reserveSeat() / releaseSeat().`)
  process.exit(1)
}

console.log('check:seats — seat counters are only moved by seatPool.service.ts')
