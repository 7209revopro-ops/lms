/* ─────────────────────────────────────────────────────────────
   Cross-academy classes — seat accounting under concurrency (plan phase 3).

   A class that serves two academies divides its room into a FLOOR per academy
   plus a shared OVERFLOW. Two properties have to survive concurrent booking and
   cancelling, and neither is obvious by reading the code:

     1. THE ROOM IS NEVER OVERSOLD. bookedCount never exceeds sessionCapacity,
        no matter how many requests arrive at once.
     2. THE ALLOCATION ALWAYS ADDS UP:
          hostSeatsLeft + Σ seatsLeft + overflowSeatsLeft + bookedCount
            === sessionCapacity
        A seat released to the wrong pool still satisfies (1). Only (2) catches
        it, which is why the invariant is asserted rather than just the total.

   And one that matters more than either: AN ACADEMY'S FLOOR IS ITS OWN. Dubai
   filling the room must not consume the seats Bangalore was promised.

   Driven at the seat-pool layer rather than over HTTP, because that is where
   the compare-and-set lives and HTTP would add a queue that hides the race.

   Run: bun run test:crossorgclass:concurrency
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_crossorgclass_conc'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { OrganizationModel, LiveClassModel, UserModel, CourseModel } = await import('@/models/schema.ts')
const { reserveSeat, releaseSeat, seatStampFrom } = await import('@/services/seatPool.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_crossorgclass_conc') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

/* A deterministic generator: a failure has to be reproducible, and Math.random
   would make "it passed on the rerun" a legitimate outcome. */
let seed = 20260918
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

interface Pools {
  bookedCount: number; sessionCapacity: number
  hostSeatsLeft: number; overflowSeatsLeft: number
  guestCohorts: Array<{ organizationId: unknown; seatsLeft: number; seatFloor: number }>
}
async function poolsOf(id: unknown): Promise<Pools> {
  return await LiveClassModel.findById(id)
    .select('bookedCount sessionCapacity hostSeatsLeft overflowSeatsLeft guestCohorts')
    .lean() as unknown as Pools
}
function addsUp(p: Pools): boolean {
  const sum = p.hostSeatsLeft + p.overflowSeatsLeft + p.bookedCount
    + p.guestCohorts.reduce((n, c) => n + c.seatsLeft, 0)
  return sum === p.sessionCapacity
}

try {
  const dubai = await OrganizationModel.create({ name: 'DXB', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'BLR', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const teacher = await UserModel.create({
    name: 'T', email: 't@t.local', passwordHash: 'x', role: 'instructor',
    isActive: true, isVerified: true, organizationId: dubai._id,
  })
  const course = await CourseModel.create({
    title: 'C', slug: `c-${Date.now()}`, description: 'x', price: 0, isFree: true,
    status: 'published', language: 'English', organizationId: dubai._id,
    instructorId: teacher._id, category: 'ai', program: 'ai',
  })

  /* capacity 20 = host floor 8 + guest floor 7 + overflow 5 */
  const mkClass = () => LiveClassModel.create({
    courseId: course._id, instructorId: teacher._id, title: 'Shared', type: 'external',
    scheduledStart: new Date(Date.now() + 86_400_000), durationMins: 60,
    organizationId: dubai._id, sessionCapacity: 20, bookedCount: 0,
    hostSeatsLeft: 8, overflowSeatsLeft: 5,
    guestCohorts: [{ organizationId: blr._id, courseId: course._id, seatFloor: 7, seatsLeft: 7 }],
  })

  /* ═══════════════════════════════════════════════════════ */
  section('The room cannot be oversold, however many arrive at once')
  {
    const live = await mkClass()
    /* 60 simultaneous attempts at 20 seats, both academies pulling at once. */
    const attempts = Array.from({ length: 60 }, (_, i) =>
      reserveSeat(String(live._id), i % 2 === 0 ? String(dubai._id) : String(blr._id)))
    const got = (await Promise.all(attempts)).filter(Boolean)

    const p = await poolsOf(live._id)
    check('exactly the capacity was handed out', got.length === 20, `${got.length} seats`)
    check('bookedCount matches what was handed out', p.bookedCount === 20, String(p.bookedCount))
    check('and the allocation still adds up', addsUp(p), JSON.stringify(p))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('One academy cannot eat the other-s floor')
  {
    const live = await mkClass()
    /* Dubai alone, hammering. Its floor is 8 and the overflow is 5. */
    const got = (await Promise.all(
      Array.from({ length: 40 }, () => reserveSeat(String(live._id), String(dubai._id))),
    )).filter(Boolean)

    const p = await poolsOf(live._id)
    check('Dubai took its floor and the overflow, and stopped', got.length === 13, `${got.length}`)
    check('Bangalore-s floor is untouched', p.guestCohorts[0]!.seatsLeft === 7,
      String(p.guestCohorts[0]!.seatsLeft))
    check('the room is not full — 7 seats are still promised to Bangalore',
      p.bookedCount === 13 && p.sessionCapacity === 20, `${p.bookedCount}/${p.sessionCapacity}`)
    check('and the allocation adds up', addsUp(p), JSON.stringify(p))

    /* And a Bangalore student can still get in, which is the entire point of a
       floor: the other academy filled the room and this one was still promised
       seats. */
    const blrSeat = await reserveSeat(String(live._id), String(blr._id))
    check('a Bangalore student still gets a seat after Dubai exhausted itself',
      blrSeat !== null && blrSeat.pool.kind === 'guest', JSON.stringify(blrSeat))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A randomised book/cancel storm keeps the invariant')
  {
    const live = await mkClass()
    const held: Array<Record<string, unknown>> = []

    for (let round = 0; round < 40; round++) {
      const ops: Array<Promise<unknown>> = []

      for (let i = 0; i < 8; i++) {
        if (held.length > 0 && rnd() < 0.4) {
          /* Cancel a seat somebody holds. Spliced out first so two rounds
             cannot release the same seat twice — which the real routes prevent
             with a conditional status transition. */
          const idx = Math.floor(rnd() * held.length)
          const seat = held.splice(idx, 1)[0]!
          ops.push(releaseSeat(seat as never))
        } else {
          const org = rnd() < 0.5 ? String(dubai._id) : String(blr._id)
          ops.push(reserveSeat(String(live._id), org).then(r => {
            if (r) held.push({ liveClassId: live._id, ...seatStampFrom(r, { organizationId: org }) })
          }))
        }
      }
      await Promise.all(ops)

      const p = await poolsOf(live._id)
      if (!addsUp(p) || p.bookedCount > p.sessionCapacity || p.bookedCount < 0) {
        check(`round ${round}: the allocation held`, false, JSON.stringify(p))
        break
      }
    }

    const p = await poolsOf(live._id)
    check('after 40 rounds of mixed booking and cancelling, the allocation adds up',
      addsUp(p), JSON.stringify(p))
    check('the counter matches the seats still held', p.bookedCount === held.length,
      `${p.bookedCount} vs ${held.length}`)
    check('no pool went negative',
      p.hostSeatsLeft >= 0 && p.overflowSeatsLeft >= 0 && p.guestCohorts.every(c => c.seatsLeft >= 0),
      JSON.stringify(p))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A seat returns to the pool it came from, not to a re-derived one')
  {
    const live = await mkClass()
    /* Exhaust Bangalore's floor so the next Bangalore seat is an OVERFLOW seat. */
    const floorSeats = []
    for (let i = 0; i < 7; i++) floorSeats.push(await reserveSeat(String(live._id), String(blr._id)))
    const overflowSeat = await reserveSeat(String(live._id), String(blr._id))
    check('the eighth Bangalore student draws from the overflow',
      overflowSeat?.pool.kind === 'overflow', JSON.stringify(overflowSeat))

    const before = await poolsOf(live._id)
    await releaseSeat({ liveClassId: live._id, ...seatStampFrom(overflowSeat!, { organizationId: String(blr._id) }) })
    const after = await poolsOf(live._id)

    check('cancelling it credits the OVERFLOW, not the Bangalore floor',
      after.overflowSeatsLeft === before.overflowSeatsLeft + 1
      && after.guestCohorts[0]!.seatsLeft === before.guestCohorts[0]!.seatsLeft,
      `overflow ${before.overflowSeatsLeft}→${after.overflowSeatsLeft}, guest ${before.guestCohorts[0]!.seatsLeft}→${after.guestCohorts[0]!.seatsLeft}`)
    check('and the allocation still adds up', addsUp(after), JSON.stringify(after))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('An unallocated class behaves exactly as it always did')
  {
    const plain = await LiveClassModel.create({
      courseId: course._id, instructorId: teacher._id, title: 'Plain', type: 'external',
      scheduledStart: new Date(Date.now() + 86_400_000), durationMins: 60,
      organizationId: dubai._id, sessionCapacity: 5, bookedCount: 0,
    })
    const got = (await Promise.all(
      Array.from({ length: 20 }, () => reserveSeat(String(plain._id), null)),
    )).filter(Boolean)
    const p = await poolsOf(plain._id)

    check('the flat cap still holds', got.length === 5, String(got.length))
    check('and it reports the flat pool, so nothing gets stamped with a floor',
      got.every(g => g!.pool.kind === 'flat'))
    check('no allocation fields were invented', p.hostSeatsLeft === undefined
      && p.overflowSeatsLeft === undefined, JSON.stringify(p))

    await releaseSeat({ liveClassId: plain._id, seatPoolKind: 'flat' })
    const after = await poolsOf(plain._id)
    check('releasing decrements the counter and nothing else', after.bookedCount === 4,
      String(after.bookedCount))
  }

  console.log(lines.join('\n'))
  console.log(`\ncrossorgclass.concurrency.suite — ${pass} passed, ${failures.length} failed`)
  if (failures.length) console.error('\nFAILURES:\n' + failures.map(f => '  · ' + f).join('\n'))
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  process.exit(failures.length ? 1 : 0)
} catch (err) {
  console.error(err)
  try { await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect() } catch {}
  process.exit(1)
}
