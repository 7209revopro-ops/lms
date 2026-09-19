/* ─────────────────────────────────────────────────────────────────────────
   Checks for the catalogue builder.  Run:  bunx --bun bun src/lib/classSchedule.check.ts

   These exist because the thing most likely to go wrong here is invisible on
   screen: a guest student's module list silently ordered, named or described
   by the HOST academy's module. That reads perfectly well and is wrong, and
   no amount of clicking around a dev database where nothing is shared would
   ever show it. So the guest rows are synthesised, with the host fields
   deliberately set to different values, and the tree is asserted to have
   used neither.
   ───────────────────────────────────────────────────────────────────────── */
import { buildCatalog, GENERAL_MODULE_ID, groupKeyOf, slotPattern } from '@/lib/classSchedule'
import type { LiveClass } from '@/lib/api/liveClasses'
import type { MyBooking } from '@/lib/api/bookings'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else    { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
const past   = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

type Row = Partial<LiveClass> & Record<string, unknown>
const row = (o: Row): LiveClass => ({
  id: 'x', title: 'Class', status: 'scheduled', scheduledStart: future(3), durationMins: 60,
  sessionCapacity: 20, bookedCount: 0, isOnline: true,
  instructor: { id: 'i1', name: 'Rania Haddad' },
  createdAt: '', updatedAt: '',
  ...o,
} as unknown as LiveClass)

/* The HOST's own course and module, identical on every row below, and always
   different from the guest's — so any leak is unmistakable. */
const HOST = {
  course:    { id: 'host-course', title: 'HOST COURSE', slug: 'h', thumbnailUrl: '/host.png' },
  sectionId: { id: 'host-sec', title: 'HOST MODULE', order: 99, description: 'HOST BLURB' },
}

const guest = (n: number, sec: { id: string; title: string; order?: number; description?: string }) => row({
  ...HOST,
  id: `g${n}`, title: 'Options Strategy Lab', scheduledStart: future(n),
  language: n % 2 ? 'Malayalam' : 'English',
  isEnrolled: true, isEntitled: true,
  yourCohort: {
    courseId: 'guest-course', courseTitle: 'Advanced Derivatives', program: '4x-trading',
    sectionId: sec.id, sectionTitle: sec.title,
    sectionOrder: sec.order, sectionDescription: sec.description,
  },
})

/* Numeric order deliberately DISAGREES with alphabetical order: "Volatility"
   comes second in the alphabet and first in the course. If a module's own
   `order` is ever ignored, the localeCompare tie-break puts Contracts first
   and A6 fails - which is the whole point of naming them this way. */
const M2 = { id: 'gs-2', title: 'Volatility and Greeks',   order: 1, description: 'Greeks blurb' }
const M1 = { id: 'gs-1', title: 'Contracts and Settlement', order: 2, description: 'Expiry blurb' }

const noBookings = new Map<string, MyBooking>()

console.log('\nA. A guest never sees the host\'s catalogue')
{
  const cat = buildCatalog([guest(1, M2), guest(2, M2), guest(3, M1)], noBookings)
  check('A1 one course, and it is the GUEST\'s', cat.length === 1 && cat[0]!.title === 'Advanced Derivatives',
    JSON.stringify(cat.map(c => c.title)))
  check('A2 it is flagged as shared with you', cat[0]!.shared === true)
  check('A3 the host\'s thumbnail is NOT borrowed', cat[0]!.thumbnailUrl === undefined, String(cat[0]!.thumbnailUrl))
  check('A4 the guest\'s programme, not the host\'s', cat[0]!.program === '4x-trading')

  const mods = cat[0]!.modules
  check('A5 two modules, both the guest\'s', mods.length === 2 && mods.every(m => m.title !== 'HOST MODULE'),
    JSON.stringify(mods.map(m => m.title)))
  check("A6 ordered by the GUEST module's own order, against the alphabet",
    mods[0]!.title === 'Volatility and Greeks' && mods[1]!.title === 'Contracts and Settlement',
    JSON.stringify(mods.map(m => [m.title, m.order])))
  check("A7 the guest module's own description, not the host's",
    mods[0]!.description === 'Greeks blurb', String(mods[0]!.description))
  check('A7b no module carries the host blurb', mods.every(m => m.description !== 'HOST BLURB'),
    JSON.stringify(mods.map(m => m.description)))
  check('A8 the host order 99 was never used', mods.every(m => m.order !== 99))
  check('A9 session counts add up', mods[0]!.sessionCount === 2 && mods[1]!.sessionCount === 1,
    JSON.stringify(mods.map(m => m.sessionCount)))
  check('A10 course total equals the sum of its modules',
    cat[0]!.sessionCount === mods.reduce((n, m) => n + m.sessionCount, 0))
  check('A11 both languages counted on the shared module',
    mods[0]!.languages.length === 2, JSON.stringify(mods[0]!.languages))
}

console.log('\nB. A host caller still sees their own')
{
  const cat = buildCatalog([row({ ...HOST, id: 'h1', isEnrolled: true, isEntitled: true, language: 'English' })], noBookings)
  check('B1 the host course', cat[0]!.title === 'HOST COURSE')
  check('B2 not flagged shared', cat[0]!.shared === false)
  check('B3 its own thumbnail IS used', cat[0]!.thumbnailUrl === '/host.png')
  check('B4 the host module, with its own order', cat[0]!.modules[0]!.title === 'HOST MODULE' && cat[0]!.modules[0]!.order === 99)
}

console.log('\nC. The catalogue is a catalogue, not a diary')
{
  const cat = buildCatalog([
    row({ ...HOST, id: 'old', scheduledStart: past(30), title: 'Long gone' }),
    row({ ...HOST, id: 'gone', scheduledStart: future(2), status: 'cancelled', title: 'Cancelled' }),
    row({ ...HOST, id: 'soon', scheduledStart: future(2), title: 'Still ahead' }),
  ], noBookings)
  const titles = cat.flatMap(c => c.modules.flatMap(m => m.groups.map(g => g.title)))
  check('C1 a finished session is dropped', !titles.includes('Long gone'), JSON.stringify(titles))
  check('C2 a cancelled session is dropped', !titles.includes('Cancelled'), JSON.stringify(titles))
  check('C3 an upcoming one is kept', titles.includes('Still ahead'))
}

console.log('\nD. A blocked module is locked, not hidden')
{
  const blocked = buildCatalog([row({ ...HOST, id: 'b1', isEnrolled: true, isEntitled: false })], noBookings)
  check('D1 still listed', blocked[0]!.modules.length === 1)
  check('D2 and marked blocked', blocked[0]!.modules[0]!.blocked === true)

  const mixed = buildCatalog([
    row({ ...HOST, id: 'b2', isEnrolled: true, isEntitled: false }),
    row({ ...HOST, id: 'b3', title: 'Other', isEnrolled: true, isEntitled: true }),
  ], noBookings)
  check('D3 one open session unblocks the module', mixed[0]!.modules[0]!.blocked === false)

  const notBought = buildCatalog([row({ ...HOST, id: 'b4', isEnrolled: false, isEntitled: false })], noBookings)
  check('D4 merely not being enrolled is NOT a block', notBought[0]!.modules[0]!.blocked === false)
}

console.log('\nE. Sessions with no module')
{
  const cat = buildCatalog([
    row({ course: HOST.course, id: 'n1', sectionId: undefined, title: 'Unmoduled' }),
    row({ ...HOST, id: 'n2', title: 'Moduled' }),
  ], noBookings)
  const mods = cat[0]!.modules
  check('E1 a General bucket exists', mods.some(m => m.id === GENERAL_MODULE_ID))
  check('E2 and it sorts LAST', mods[mods.length - 1]!.id === GENERAL_MODULE_ID,
    JSON.stringify(mods.map(m => m.title)))
}

console.log('\nF. A class taught in two languages is TWO series, not one')
{
  /* Caught on screen, not by a test: a module card read "2 Languages,
     8 Sessions" and the sheet beneath it listed ONE English slot holding all
     eight. The group key ignored language, so the Malayalam sessions were
     swallowed into the English group, the modal's single language badge
     mislabelled half of them, and the weekly pattern could never form
     because two interleaved schedules never agree on a weekday. */
  const series = (lang: string, dayOffset: number, hour: number) =>
    [0, 1, 2, 3].map(w => {
      const d = new Date('2026-10-05T00:00:00Z')            // a Monday
      d.setUTCDate(d.getUTCDate() + w * 7 + dayOffset)
      d.setUTCHours(hour, 0, 0, 0)
      return row({ ...HOST, id: `${lang}${w}`, title: 'Core Concepts', language: lang,
                   scheduledStart: d.toISOString(), isEnrolled: true, isEntitled: true })
    })

  const rows = [...series('English', 1, 15), ...series('Malayalam', 3, 6)]
  const cat  = buildCatalog(rows, noBookings)
  const mod  = cat[0]!.modules[0]!

  check('F1 the two languages are two groups', mod.groups.length === 2,
    JSON.stringify(mod.groups.map(g => g.slots.length)))
  check('F2 neither group mixes languages',
    mod.groups.every(g => new Set(g.slots.map(s => (s as { language?: string }).language)).size === 1),
    JSON.stringify(mod.groups.map(g => g.slots.map(s => (s as { language?: string }).language))))
  check('F3 every session is still accounted for',
    mod.groups.reduce((n, g) => n + g.slots.length, 0) === 8 && mod.sessionCount === 8,
    String(mod.sessionCount))
  check('F4 the module still counts two languages', mod.languages.length === 2,
    JSON.stringify(mod.languages))
  check('F5 the count and the slots agree - what the screen got wrong',
    mod.languages.length === mod.groups.length)

  /* The weekly pattern is only findable once the schedules are separated. */
  check('F6 each group now claims its weekday',
    mod.groups.every(g => slotPattern(g.slots) !== null),
    JSON.stringify(mod.groups.map(g => slotPattern(g.slots))))
  check('F7 and a merged group would NOT have', slotPattern(rows) === null)

  check('F8 language is part of the key', groupKeyOf(rows[0]!) !== groupKeyOf(rows[4]!),
    `${groupKeyOf(rows[0]!)} vs ${groupKeyOf(rows[4]!)}`)
}

console.log(`\nclassSchedule.check — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
