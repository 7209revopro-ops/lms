/* ─────────────────────────────────────────────────────────────
   Class mail says which clock it means (plan phase 5).

   The student app renders in the student's own DEVICE zone, deliberately.
   Mail rendered in a hard-coded Asia/Dubai with NO LABEL. A Bangalore student
   therefore reads one time on screen and another in every confirmation and
   reminder — ninety minutes apart, with nothing on either saying which is
   which.

   It has not bitten yet only because a student could never be booked into
   another academy's class. Cross-academy classes remove that accident, so the
   label goes on first: a labelled wrong time is a question, an unlabelled
   wrong time is a missed class.

   Run: bun run test:academyclock
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'
export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const { academyClock, academyTime, zoneForAcademy, zoneTag, DEFAULT_ACADEMY_TZ } =
  await import('@/utils/academyClock.ts')

/* 09:00 Bangalore on 18 Sep 2026 = 03:30 UTC = 07:30 Dubai. The exact gap the
   product gets wrong, taken from the real class in the local database. */
const CLASS_AT = new Date('2026-09-18T03:30:00.000Z')

section('The same instant, read by two academies')
{
  const blr = academyClock(CLASS_AT, 'bangalore')
  const dxb = academyClock(CLASS_AT, 'dubai')

  check('Bangalore reads 09:00', blr.time.startsWith('09:00'), blr.time)
  check('Dubai reads 07:30 for the SAME instant', dxb.time.startsWith('07:30'), dxb.time)
  check('and they are genuinely different strings', blr.time !== dxb.time, `${blr.time} / ${dxb.time}`)
}

section('Every rendering carries its zone — this is the whole point')
{
  const blr = academyClock(CLASS_AT, 'bangalore')
  const dxb = academyClock(CLASS_AT, 'dubai')

  check('Bangalore is labelled IST', blr.time.endsWith('IST'), blr.time)
  check('Dubai is labelled GST', dxb.time.endsWith('GST'), dxb.time)
  check('the long form is labelled too', blr.full.endsWith('IST'), blr.full)
  check('and the short helper is labelled', academyTime(CLASS_AT, 'bangalore').endsWith('IST'),
    academyTime(CLASS_AT, 'bangalore'))
  check('an unknown academy still gets a label rather than a bare time',
    academyClock(CLASS_AT, 'atlantis').time.endsWith('GST'),
    academyClock(CLASS_AT, 'atlantis').time)
}

section('A single-academy install is unchanged')
{
  check('no academy falls back to the backend-s own zone',
    zoneForAcademy(null) === DEFAULT_ACADEMY_TZ && DEFAULT_ACADEMY_TZ === 'Asia/Dubai',
    zoneForAcademy(null))
  check('an unknown slug falls back too, rather than throwing',
    zoneForAcademy('nowhere') === 'Asia/Dubai', zoneForAcademy('nowhere'))
  check('the fallback prints the same wall clock it always did',
    academyClock(CLASS_AT).time.startsWith('07:30'), academyClock(CLASS_AT).time)
  check('an unmapped zone is labelled with the zone name, never left blank',
    zoneTag('Pacific/Chatham') === 'Pacific/Chatham', zoneTag('Pacific/Chatham'))
}

section('An invalid date never reaches a student')
{
  /* This has actually shipped: a localised label went out reading
     "Invalid Date at Invalid Date". A dash is obviously missing; a confident
     wrong answer is not. */
  for (const [label, value] of [
    ['null', null], ['undefined', undefined], ['empty string', ''],
    ['unparseable string', 'not a date'], ['an Invalid Date', new Date('nope')],
  ] as Array<[string, unknown]>) {
    const c = academyClock(value as never, 'bangalore')
    check(`${label} renders as a dash, not "Invalid Date"`,
      c.full === '—' && !c.full.includes('Invalid'), c.full)
  }

  check('and a real date still renders after all that',
    academyClock(CLASS_AT, 'bangalore').full.includes('September'),
    academyClock(CLASS_AT, 'bangalore').full)
}

section('Strings are accepted, because half the callers pass them')
{
  const fromIso = academyClock(CLASS_AT.toISOString(), 'bangalore')
  const fromDate = academyClock(CLASS_AT, 'bangalore')
  check('an ISO string and a Date give the same answer', fromIso.full === fromDate.full,
    `${fromIso.full} / ${fromDate.full}`)
}

console.log(lines.join('\n'))
console.log(`\nacademyclock.suite — ${pass} passed, ${failures.length} failed`)
if (failures.length) console.error('\nFAILURES:\n' + failures.map(f => '  · ' + f).join('\n'))
process.exit(failures.length ? 1 : 0)
