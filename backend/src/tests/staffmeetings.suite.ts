/* ─────────────────────────────────────────────────────────────
   A staff meeting (the user, 2026-11-14: a Chief Mentor's meeting with several mentors — "staff can be selected…
   if they have a meeting at that time it shows the specific mentor"):
     A. booked with other mentors in it: kept on the meeting, each among the people invited, nobody need be typed
     B. on every one of their calendars, and on nobody else's
     C. each is busy then: nothing else is booked with them over it — as its own mentor, or in another staff meeting
     D. never booked over anybody in it: refused with whoever is in the way, by name — a class they teach or
        co-mentor, a meeting of theirs, a staff meeting they are in, their time off
     E. who can be named: a mentor this asker may book; the meeting's own mentor counts once
     F. changed: moved (everybody checked again), somebody added (only they are checked), somebody taken off (free
        again, no longer invited); a title edit stays possible whatever was put beside it since
     G. called off: off everybody's calendar, everybody free again
     H. any other meeting is as it was: it needs somebody named, and has no staff
   Run: bun --no-env-file src/tests/staffmeetings.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.STAFFMEETINGS_DB_URL || 'mongodb://localhost:27017/lms_staffmeetings'
process.env.NODE_ENV = 'test'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'staffmeetings-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'staffmeetings-suite-refresh-secret-0123456789'

export {}

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)
/** The refusal a call makes: its words and status; '' when it goes through. */
const refusal = async (f: () => Promise<unknown>): Promise<{ message: string; status: number }> => {
  try { await f(); return { message: '', status: 200 } } catch (e: any) { return { message: String(e?.message ?? e), status: Number(e?.statusCode ?? e?.status ?? 0) } }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const { listMentorsForPortal, createMentorMeetingForPortal, getMentorMeetingForPortal, updateMentorMeetingForPortal, cancelMentorMeetingForPortal } = await import('@/services/portal.service.ts')
const { bookedWithin } = await import('@/services/mentorTimeOff.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_staffmeetings') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' })
  const mk = (name: string, org: unknown) => M.UserModel.create({ name, email: `${name.toLowerCase()}@sm.local`, passwordHash: 'x', role: 'instructor', isActive: true, isVerified: true, organizationId: org })
  const chief = await mk('Chief', dubai._id), ana = await mk('Ana', dubai._id), bo = await mk('Bo', dubai._id), cy = await mk('Cy', dubai._id), dee = await mk('Dee', dubai._id)
  const ravi = await mk('Ravi', blr._id)
  const org = String(dubai._id)
  const day = new Date(Date.now() + 3 * 864e5); day.setUTCHours(8, 0, 0, 0)
  const at = (mins: number) => new Date(day.getTime() + mins * 60_000)
  const iso = (mins: number) => at(mins).toISOString()
  const from = new Date(day.getTime() - 864e5).toISOString(), to = new Date(day.getTime() + 864e5).toISOString()
  const base = { remoteOrgId: org, mentorEmail: 'chief@sm.local', title: 'Weekly team meeting', kind: 'staff', durationMins: 60, bookedByEmail: 'chief@sm.local' }
  const columns = async () => {
    const r = await listMentorsForPortal({ remoteOrgId: org, from, to })
    return new Map(r.mentors.map((m) => [m.name, m.meetings]))
  }

  // ── A. booked ─────────────────────────────────────────────────────────────
  const a = await createMentorMeetingForPortal({ ...base, scheduledStart: iso(0), staffEmails: ['ana@sm.local', 'BO@sm.local', 'ana@sm.local', 'chief@sm.local'] })
  const id = a.meeting.id
  let row = await M.MentorMeetingModel.findById(id).lean()
  check('A. booked with nobody typed: Ana and Bo kept on it — each once, the Chief not among them', (row?.staffIds ?? []).map(String).sort().join() === [String(ana._id), String(bo._id)].sort().join(), j(row?.staffIds))
  check('A. …both among the people invited, with their addresses', a.meeting.attendees.map((x) => `${x.name}:${x.email}`).sort().join() === 'Ana:ana@sm.local,Bo:bo@sm.local' && (a.meeting.staff ?? []).length === 2, j(a.meeting))
  const typed = await createMentorMeetingForPortal({ ...base, title: 'With a guest', scheduledStart: iso(600), staffEmails: ['ana@sm.local'], attendees: [{ name: 'A guest', email: 'guest@out.test' }, { name: 'Ana typed too', email: 'ana@sm.local' }] })
  check('A. somebody typed as well: the guest kept, a mentor typed and ticked invited once', typed.meeting.attendees.map((x) => x.email).sort().join() === 'ana@sm.local,guest@out.test', j(typed.meeting.attendees))
  await cancelMentorMeetingForPortal({ remoteOrgId: org, meetingId: typed.meeting.id, actorEmail: 'chief@sm.local', silent: true })

  // ── B. on their calendars ────────────────────────────────────────────────
  let cols = await columns()
  const has = (name: string) => (cols.get(name) ?? []).some((m) => m.id === id)
  check('B. on the Chief\'s, Ana\'s and Bo\'s calendars — not Cy\'s or Dee\'s', has('Chief') && has('Ana') && has('Bo') && !has('Cy') && !has('Dee'))
  const onAna = (cols.get('Ana') ?? []).find((m) => m.id === id)
  check('B. …said to be a staff meeting, and whose', onAna?.staffMeeting === true && onAna?.mentorName === 'Chief' && onAna.attendeeNames.join() === 'Ana,Bo', j(onAna))

  // ── C. each is busy then ────────────────────────────────────────────────
  let r = await refusal(() => createMentorMeetingForPortal({ ...base, mentorEmail: 'ana@sm.local', title: 'Ana and a client', kind: 'client', scheduledStart: iso(30), attendees: [{ name: 'A client' }] }))
  check('C. a meeting of Ana\'s own over it: refused', r.status === 409 && /overlaps a meeting already booked: Weekly team meeting/.test(r.message), j(r))
  r = await refusal(() => createMentorMeetingForPortal({ ...base, mentorEmail: 'cy@sm.local', title: 'Another staff meeting', scheduledStart: iso(-30), staffEmails: ['bo@sm.local', 'dee@sm.local'] }))
  check('C. another staff meeting with Bo in it over it: refused, naming Bo and what he is in — not Dee', r.status === 409 && /Busy then: Bo \(meeting: Weekly team meeting\)/.test(r.message) && !/Dee/.test(r.message), j(r))
  const beside = await createMentorMeetingForPortal({ ...base, mentorEmail: 'ana@sm.local', title: 'Right after', kind: 'client', scheduledStart: iso(60), durationMins: 30, attendees: [{ name: 'A client' }] })
  check('C. the half hour right after it: free', !!beside.meeting.id)
  check('C. …and what is inside a time off marked over it names the staff meeting, for Ana', (await bookedWithin(String(ana._id), { startsAt: at(-10), endsAt: at(20) })).some((x) => x.kind === 'meeting' && x.id === id))

  // ── D. never booked over anybody in it ──────────────────────────────────
  await M.LiveClassModel.collection.insertMany([
    { title: 'Forex A', instructorId: cy._id, organizationId: dubai._id, scheduledStart: at(300), durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 30 },
    { title: 'Programme day', instructorId: ravi._id, coInstructorIds: [dee._id], organizationId: dubai._id, scheduledStart: at(300), durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 30 },
    { title: 'Called off', instructorId: bo._id, organizationId: dubai._id, scheduledStart: at(300), durationMins: 60, status: 'cancelled', bookedCount: 0, sessionCapacity: 30 },
  ] as any[])
  await M.MentorTimeOffModel.create({ mentorId: ana._id, startsAt: at(280), endsAt: at(400), reason: 'Leave' })
  r = await refusal(() => createMentorMeetingForPortal({ ...base, title: 'Afternoon', scheduledStart: iso(330), durationMins: 30, staffEmails: ['ana@sm.local', 'bo@sm.local', 'cy@sm.local', 'dee@sm.local'] }))
  check('D. over a class taught, a class co-mentored and a time off: refused, each named with what is in the way', r.status === 409
    && /Cy \(class: Forex A\)/.test(r.message) && /Dee \(class: Programme day\)/.test(r.message) && /Ana \(not available\)/.test(r.message), j(r))
  check('D. …Bo, whose only class then is cancelled, is not named; nothing was booked', !/Bo/.test(r.message) && (await M.MentorMeetingModel.countDocuments({ title: 'Afternoon' })) === 0, j(r))
  const ok = await createMentorMeetingForPortal({ ...base, title: 'Afternoon', scheduledStart: iso(330), durationMins: 30, staffEmails: ['bo@sm.local'] })
  check('D. with only Bo, who is free then: booked', !!ok.meeting.id && (ok.meeting.staff ?? [])[0]?.email === 'bo@sm.local')
  await cancelMentorMeetingForPortal({ remoteOrgId: org, meetingId: ok.meeting.id, actorEmail: 'chief@sm.local', silent: true })

  // ── E. who can be named ────────────────────────────────────────────────
  r = await refusal(() => createMentorMeetingForPortal({ ...base, title: 'With a stranger', scheduledStart: iso(700), staffEmails: ['bo@sm.local', 'nobody@sm.local'] }))
  check('E. an address that is no mentor\'s: refused, naming it', r.status === 404 && /nobody@sm\.local/.test(r.message) && !/bo@/.test(r.message), j(r))
  r = await refusal(() => createMentorMeetingForPortal({ ...base, title: 'Across', scheduledStart: iso(700), staffEmails: ['ravi@sm.local'] }))
  check('E. the other academy\'s mentor, not asked for both academies: refused', r.status === 404 && /ravi@sm\.local/.test(r.message), j(r))
  const across = await createMentorMeetingForPortal({ ...base, title: 'Across', scheduledStart: iso(700), staffEmails: ['ravi@sm.local'], allAcademies: true })
  check('E. …asked for both: booked with him in it', (across.meeting.staff ?? [])[0]?.email === 'ravi@sm.local')
  await cancelMentorMeetingForPortal({ remoteOrgId: org, meetingId: across.meeting.id, actorEmail: 'chief@sm.local', silent: true })

  // ── F. changed ─────────────────────────────────────────────────────────
  const detail = await getMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'chief@sm.local' })
  check('F. read back for changing: its mentors', detail.staff.map((s) => s.email).sort().join() === 'ana@sm.local,bo@sm.local' && detail.mentorEmail === 'chief@sm.local', j(detail.staff))
  r = await refusal(() => updateMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'chief@sm.local', scheduledStart: iso(300) }))
  check('F. moved into Ana\'s time off: refused naming her, and left where it was', r.status === 409 && /Ana \(not available\)/.test(r.message) && +new Date((await M.MentorMeetingModel.findById(id).lean())!.scheduledStart) === +at(0), j(r))
  r = await refusal(() => updateMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'chief@sm.local', scheduledStart: iso(45) }))
  check('F. moved over Ana\'s own meeting beside it: refused naming her', r.status === 409 && /Ana \(meeting: Right after\)/.test(r.message), j(r))
  // A class put on Bo over the meeting since (classes don't look at meetings): a title edit must still go through.
  await M.LiveClassModel.collection.insertOne({ title: 'Squeezed in', instructorId: bo._id, organizationId: dubai._id, scheduledStart: at(15), durationMins: 30, status: 'scheduled', bookedCount: 0, sessionCapacity: 30 } as any)
  let u = await updateMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'chief@sm.local', title: 'Weekly team meeting (room 2)' })
  check('F. a title edit, where it is with the same people: goes through whatever was put beside it since', u.title === 'Weekly team meeting (room 2)' && u.staff.length === 2, j(u))
  r = await refusal(() => updateMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'chief@sm.local', staffEmails: ['ana@sm.local', 'bo@sm.local', 'cy@sm.local'], scheduledStart: iso(300) }))
  check('F. moved and Cy added, into Cy\'s class: refused naming everybody in the way', r.status === 409 && /Cy \(class: Forex A\)/.test(r.message) && /Ana \(not available\)/.test(r.message), j(r))
  u = await updateMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'chief@sm.local', staffEmails: ['ana@sm.local', 'bo@sm.local', 'dee@sm.local'] })
  row = await M.MentorMeetingModel.findById(id).lean()
  check('F. Dee added, where it is: only Dee is checked (Bo\'s later class is not in the way), she is in it and invited', u.notified === true && (row?.staffIds ?? []).map(String).includes(String(dee._id))
    && (row?.attendees ?? []).some((x) => x.email === 'dee@sm.local') && (row?.attendees ?? []).length === 3, j(row?.attendees))
  u = await updateMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'chief@sm.local', staffEmails: ['bo@sm.local', 'dee@sm.local'] })
  row = await M.MentorMeetingModel.findById(id).lean()
  check('F. Ana taken off: no longer in it or invited', !(row?.staffIds ?? []).map(String).includes(String(ana._id)) && !(row?.attendees ?? []).some((x) => x.email === 'ana@sm.local') && (row?.attendees ?? []).length === 2, j(row?.attendees))
  cols = await columns()
  check('F. …off her calendar, still on Bo\'s and Dee\'s', !has('Ana') && has('Bo') && has('Dee') && has('Chief'))
  const freed = await createMentorMeetingForPortal({ ...base, mentorEmail: 'ana@sm.local', title: 'Ana is free again', kind: 'client', scheduledStart: iso(0), durationMins: 30, attendees: [{ name: 'A client' }] })
  check('F. …and she can be booked then again', !!freed.meeting.id)
  r = await refusal(() => updateMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'ana@sm.local', title: 'Not mine to change' }))
  check('F. only whoever booked it changes it', r.status === 403, j(r))

  // ── G. called off ──────────────────────────────────────────────────────
  await cancelMentorMeetingForPortal({ remoteOrgId: org, meetingId: id, actorEmail: 'chief@sm.local', silent: true })
  cols = await columns()
  check('G. called off: off everybody\'s calendar', !has('Chief') && !has('Bo') && !has('Dee'))
  const after = await createMentorMeetingForPortal({ ...base, mentorEmail: 'dee@sm.local', title: 'Dee is free again', kind: 'client', scheduledStart: iso(0), durationMins: 30, attendees: [{ name: 'A client' }] })
  check('G. …and everybody in it free again', !!after.meeting.id)

  // ── H. any other meeting, as it was ───────────────────────────────────
  r = await refusal(() => createMentorMeetingForPortal({ ...base, title: 'Nobody named', scheduledStart: iso(900) }))
  check('H. a meeting with nobody named and no staff: still refused', r.status === 400 && /Say who the mentor is meeting/.test(r.message), j(r))
  r = await refusal(() => createMentorMeetingForPortal({ ...base, title: 'Empty staff', scheduledStart: iso(900), staffEmails: [] }))
  check('H. …and with an empty list of staff', r.status === 400 && /Say who the mentor is meeting/.test(r.message), j(r))
  const plain = await createMentorMeetingForPortal({ ...base, title: 'A plain staff chat', scheduledStart: iso(900), attendees: [{ name: 'Somebody' }] })
  const plainRow = await M.MentorMeetingModel.findById(plain.meeting.id).lean()
  cols = await columns()
  check('H. one booked the old way: no staff on it, on its own mentor\'s calendar only, not said to be a staff meeting', (plainRow?.staffIds ?? []).length === 0 && (plain.meeting.staff ?? []).length === 0
    && (cols.get('Chief') ?? []).find((m) => m.id === plain.meeting.id)?.staffMeeting === false && !(cols.get('Ana') ?? []).some((m) => m.id === plain.meeting.id))
} catch (err) {
  fail++; console.log('  FAIL  threw', err)
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
