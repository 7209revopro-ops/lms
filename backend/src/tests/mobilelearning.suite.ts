/* ─────────────────────────────────────────────────────────────
   The mobile app's Learning tab against the real API (plan.md §13.12 P2).

   The app reads every response through the normalisers and rules in
   shared/src/learning.ts. This suite signs in exactly as the app does
   (X-Client: mobile, X-Device-Id, Bearer) and feeds the real responses
   through those same functions — so a change to an endpoint's shape that
   would break the app fails here, not on a student's phone.

     A  My learning — enrolments, populated course
     B  Course outline — order across modules, no raw video URL, the module lock
     C  Video — signed play URL, the module lock agrees with the app's gate,
        watch-time limits the app's counter is built around
     D  Mark complete → progress and Resume
     E  Notes — save, read, empty = delete
     F  Quiz — answers are choice INDEXES, a fail leaks no answer key
     G  Class assignments — upload, submit, duplicate, revision
     H  A pending student — why the app does not ask for /progress

   --no-env-file; R2, mail, WhatsApp and Google are blanked so nothing leaves
   the machine (uploads land on local disk and are deleted at the end).
   Run: bun run test:mobilelearning
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mobilelearning_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.GOOGLE_CLIENT_ID = ''; process.env.GOOGLE_CLIENT_SECRET = ''; process.env.GOOGLE_REFRESH_TOKEN = ''
process.env.GOOGLE_MEET_HOST_EMAIL = ''; process.env.GOOGLE_CALENDAR_ID = ''
/* Blank storage credentials: with R2 configured, the upload test would write
   to the real bucket. */
process.env.R2_ACCOUNT_ID = ''; process.env.R2_ACCESS_KEY_ID = ''; process.env.R2_SECRET_ACCESS_KEY = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.JWT_ACCESS_SECRET  ??= 'mobilelearning-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mobilelearning-suite-refresh-secret-0123456789'

export {}

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
const { isR2Configured } = await import('@/services/r2.service.ts')
const S = await import('../../../shared/src/index.ts')
type QQ = import('../../../shared/src/learning.ts').QuizQuestion
const fs = await import('node:fs')
const path = await import('node:path')

if (isR2Configured()) { console.error('REFUSING TO RUN — R2 credentials reached the suite; uploads would hit the real bucket'); process.exit(1) }

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mobilelearning_suite') { console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.DeviceModel.syncIndexes()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
const uploadedFiles: string[] = []

/* Signs in the way the app does and returns a caller bound to that session. */
async function appSession(email: string, deviceId: string) {
  const headers = { 'x-client': 'mobile', 'x-device-id': deviceId, 'user-agent': 'DeltaLMS/1.0.0 (Pixel 8; Android 15)' }
  const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })
  const token = (await login.json() as any)?.data?.tokens?.accessToken as string | undefined
  if (!token) throw new Error(`sign-in failed for ${email}: ${login.status}`)
  return async (method: string, p: string, body?: unknown, form?: FormData) => {
    const h: Record<string, string> = { ...headers, authorization: `Bearer ${token}` }
    if (body !== undefined) h['content-type'] = 'application/json'
    const res = await fetch(`${BASE}${p}`, { method, headers: h, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
    let json: any = null; try { json = await res.json() } catch { /* empty */ }
    return { status: res.status, body: json, data: json?.data }
  }
}

try {
  /* ── Fixture: one course, two modules (B locked for the student), a video,
     an article and a quiz in A, a video in B; one booked class. ── */
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mkUser = (email: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role: 'student', isActive: true, isVerified: true,
    enrollmentStatus: 'approved', organizationId: org._id, ...extra,
  })
  const mentor = await mkUser('mentor@app.local', { role: 'instructor', enrollmentStatus: undefined })
  const amal = await mkUser('amal@app.local')
  const pendingStudent = await mkUser('pending@app.local', { enrollmentStatus: 'pending' })

  const course = await M.CourseModel.create({
    title: 'Forex Foundations', slug: 'forex-foundations', instructorId: mentor._id, organizationId: org._id,
    status: 'published', price: 0, isFree: true, language: 'en',
  })
  /* Created out of order on purpose: the app must order by module, then lesson. */
  const modB = await M.SectionModel.create({ courseId: course._id, title: 'Risk', order: 2 })
  const modA = await M.SectionModel.create({ courseId: course._id, title: 'Basics', order: 1 })
  const quizL  = await M.LessonModel.create({ courseId: course._id, sectionId: modA._id, title: 'Check yourself', type: 'quiz', order: 3, durationMins: 5 })
  const lockedV = await M.LessonModel.create({ courseId: course._id, sectionId: modB._id, title: 'Position sizing', type: 'video', order: 1, durationMins: 12, contentUrl: 'https://cdn.example.invalid/b1.mp4' })
  const video  = await M.LessonModel.create({ courseId: course._id, sectionId: modA._id, title: 'What is a pip', type: 'video', order: 1, durationMins: 10, contentUrl: 'https://cdn.example.invalid/a1.mp4' })
  const article = await M.LessonModel.create({ courseId: course._id, sectionId: modA._id, title: 'Glossary', type: 'article', order: 2, durationMins: 4, contentBody: 'Pip: the smallest move.', contentUrl: 'https://cdn.example.invalid/glossary.pdf' })
  await M.QuizModel.create({
    lessonId: quizL._id, courseId: course._id, passPercent: 70, questions: [
      { text: 'Which pair is a major?', type: 'mcq', choices: ['EUR/USD', 'USD/TRY', 'ZAR/JPY'], correctAnswer: '0', points: 1, explanation: 'EUR/USD is the most traded.' },
      { text: 'A pip is a price move.', type: 'true_false', choices: ['True', 'False'], correctAnswer: '0', points: 1 },
      { text: 'The spread is bid minus …?', type: 'short', correctAnswer: 'Ask', points: 1 },
    ],
  })
  await M.EnrollmentModel.create({ userId: amal._id, courseId: course._id, status: 'active', source: 'admin', blockedLessons: [modB._id] })
  await M.EnrollmentModel.create({ userId: pendingStudent._id, courseId: course._id, status: 'active', source: 'admin' })
  const lc = await M.LiveClassModel.create({
    courseId: course._id, sectionId: modA._id, instructorId: mentor._id, organizationId: org._id,
    title: 'Live: pips in practice', scheduledStart: new Date(Date.now() - 2 * 3600_000), durationMins: 60, type: 'external', status: 'ended',
  })
  await M.ClassBookingModel.create({ userId: amal._id, liveClassId: lc._id, status: 'attended' })

  const call = await appSession('amal@app.local', 'a'.repeat(64))

  /* ═══ A ═══ */
  section('A. My learning')
  const en = await call('GET', '/enrollments/me')
  const mine = Array.isArray(en.data) ? en.data.map(S.normalizeEnrollment) : []
  check('A1 200 and one enrolment', en.status === 200 && mine.length === 1, why(en))
  check('A2 its course is populated: id, title, slug the app routes by', mine[0]?.course?.slug === 'forex-foundations' && mine[0]?.course?.title === 'Forex Foundations' && !!mine[0]?.course?.id, JSON.stringify(mine[0]?.course))
  check('A3 the mentor\'s name comes through', mine[0]?.course?.instructor?.name === 'mentor', JSON.stringify(mine[0]?.course?.instructor))
  check('A4 not started yet → bucket notStarted', !!mine[0] && S.bucketOf(mine[0]) === 'notStarted')

  /* ═══ B ═══ */
  section('B. Course outline')
  const cd = await call('GET', '/courses/forex-foundations')
  const detail = S.normalizeCourseDetail(cd.data)
  const seq = S.lessonSequence(detail)
  check('B1 200', cd.status === 200, why(cd))
  check('B2 lessons in module order, then lesson order', seq.map(l => l.title).join(' | ') === 'What is a pip | Glossary | Check yourself | Position sizing', seq.map(l => l.title).join(' | '))
  const vDto = detail.lessons.find(l => l.id === String(video._id))
  check('B3 a video lesson says hasVideo and ships NO address', vDto?.hasVideo === true && !vDto?.contentUrl, JSON.stringify(vDto))
  const aDto = detail.lessons.find(l => l.id === String(article._id))
  check('B4 an article ships its body and resource link; the link reads as a PDF', aDto?.contentBody === 'Pip: the smallest move.' && S.resourceKind(aDto?.contentUrl) === 'pdf', JSON.stringify(aDto))
  const pr = await call('GET', '/courses/forex-foundations/progress')
  const progress = pr.data as import('../../../shared/src/learning.ts').CourseProgress
  check('B5 progress: enrolled, 0%, the locked MODULE id in blockedLessons', pr.status === 200 && progress?.isEnrolled === true && progress.progressPercent === 0 && progress.blockedLessons.includes(String(modB._id)), why(pr))
  const gateOf = (id: unknown) => S.lessonGate(detail.lessons.find(l => l.id === String(id))!, progress, 'approved')
  check('B6 the app\'s gate: module B\'s lesson is blocked, module A\'s open', gateOf(lockedV._id) === 'blocked' && gateOf(video._id) === 'open' && gateOf(article._id) === 'open')

  /* ═══ C ═══ */
  section('C. Video')
  const pu = await call('GET', `/lessons/${video._id}/play-url`)
  check('C1 an open lesson gets a play URL with a lifetime', pu.status === 200 && typeof pu.data?.url === 'string' && pu.data.url.length > 0 && typeof pu.data?.expiresIn === 'number', why(pu))
  const puLocked = await call('GET', `/lessons/${lockedV._id}/play-url`)
  check('C2 the lesson the app shows as blocked is refused by the server too: 403 MODULE_LOCKED', puLocked.status === 403 && puLocked.body?.error?.code === 'MODULE_LOCKED', why(puLocked))
  const lp0 = await call('GET', `/lessons/${video._id}/progress`)
  check('C3 lesson progress before watching: 0 s, not completed', lp0.status === 200 && lp0.data?.watchTimeSecs === 0 && lp0.data?.isCompleted === false, why(lp0))
  const w1 = await call('POST', `/lessons/${video._id}/watch-time`, { secs: S.WATCH_REPORT_SECS })
  const wMax = await call('POST', `/lessons/${video._id}/watch-time`, { secs: S.WATCH_REPORT_MAX })
  check('C4 a normal report and a report at the app\'s cap are both accepted', w1.status === 200 && wMax.status === 200, `${why(w1)} / ${why(wMax)}`)
  const wOver = await call('POST', `/lessons/${video._id}/watch-time`, { secs: S.WATCH_REPORT_MAX + 1 })
  check('C5 one second over the cap is refused (422) — the cap the app clamps to is the server\'s', wOver.status === 422, why(wOver))
  const lp1 = await call('GET', `/lessons/${video._id}/progress`)
  const savedSecs = lp1.data?.watchTimeSecs
  check('C6 the reports add up to the resume position', savedSecs === S.WATCH_REPORT_SECS + S.WATCH_REPORT_MAX, JSON.stringify(lp1.data))
  check('C7 and the app resumes from there in a long video', S.resumeAt(savedSecs, 3600) === savedSecs)
  /* QA round 2026-10-21: resume from the playback POSITION, not the total
     watched — rewatching 0–5 min must not jump the next visit to 10:00. */
  const wp = await call('POST', `/lessons/${video._id}/watch-time`, { secs: 15, position: 95.7 })
  const lp2 = (await call('GET', `/lessons/${video._id}/progress`)).data
  check('C8 a report with the playback position stores it (floored) beside the total', wp.status === 200 && lp2?.lastPositionSecs === 95 && lp2?.watchTimeSecs === savedSecs + 15, JSON.stringify(lp2))
  await call('POST', `/lessons/${video._id}/watch-time`, { secs: 300, position: 20 })   // rewound and rewatched
  const lp3 = (await call('GET', `/lessons/${video._id}/progress`)).data
  check('C9 after rewinding: the total keeps growing, but the app resumes at the real position (20 s)', lp3?.watchTimeSecs > 300 && S.savedPosition(lp3) === 20, JSON.stringify(lp3))
  const badPos = await call('POST', `/lessons/${video._id}/watch-time`, { secs: 15, position: -1 })
  check('C10 a negative position is refused (422)', badPos.status === 422, why(badPos))
  check('C11 a row from before positions existed resumes from the total, as it always did', S.savedPosition({ watchTimeSecs: 120 }) === 120 && S.savedPosition({ watchTimeSecs: 120, lastPositionSecs: null }) === 120)

  /* ═══ D ═══ */
  section('D. Mark complete')
  const done1 = await call('POST', `/lessons/${video._id}/complete`)
  check('D1 200 with the new course percent (1 of 4 lessons)', done1.status === 200 && done1.data?.progressPercent === 25, why(done1))
  const pr2 = (await call('GET', '/courses/forex-foundations/progress')).data
  check('D2 progress lists the lesson as completed', pr2?.completedLessons?.includes(String(video._id)), JSON.stringify(pr2?.completedLessons))
  const resume = S.resumeLesson(seq, pr2)
  check('D3 Resume lands on a real lesson of this course', !!resume && seq.some(l => l.id === resume.id), JSON.stringify({ last: pr2?.lastLessonId, resume: resume?.title }))
  const en2 = (await call('GET', '/enrollments/me')).data.map(S.normalizeEnrollment)
  check('D4 My learning now shows it in progress', S.bucketOf(en2[0]) === 'inProgress' && en2[0].progressPercent === 25, JSON.stringify(en2[0]))

  /* ═══ E ═══ */
  section('E. Notes')
  const n0 = await call('GET', `/lessons/${video._id}/my-note`)
  check('E1 no note yet: { note: null }', n0.status === 200 && n0.data?.note === null, why(n0))
  const put = await call('PUT', `/lessons/${video._id}/my-note`, { body: 'Pips are tiny.' })
  const n1 = await call('GET', `/lessons/${video._id}/my-note`)
  check('E2 save, then read back', put.status === 200 && n1.data?.note?.body === 'Pips are tiny.', `${why(put)} ${JSON.stringify(n1.data)}`)
  const emptyPut = await call('PUT', `/lessons/${video._id}/my-note`, { body: '' })
  check('E3 an empty PUT is refused (422) — which is why the app DELETEs an emptied note', emptyPut.status === 422, why(emptyPut))
  const del = await call('DELETE', `/lessons/${video._id}/my-note`)
  const n2 = await call('GET', `/lessons/${video._id}/my-note`)
  check('E4 DELETE clears it (204)', del.status === 204 && n2.data?.note === null, `${why(del)} ${JSON.stringify(n2.data)}`)

  /* ═══ F ═══ */
  section('F. Quiz')
  const qz = await call('GET', `/quizzes/lessons/${quizL._id}`)
  const quiz = qz.data as import('../../../shared/src/learning.ts').StudentQuiz
  check('F1 200, three questions', qz.status === 200 && quiz?.questions?.length === 3, why(qz))
  check('F2 the answer key is not sent', !JSON.stringify(qz.data ?? {}).includes('correctAnswer'))
  const [mcq, tf, short] = quiz.questions as [QQ, QQ, QQ]
  check('F3 choice values are indexes: EUR/USD = "0"', S.choicesOf(mcq).find(c => c.label === 'EUR/USD')?.value === '0')
  const wrong = await call('POST', `/quizzes/lessons/${quizL._id}/submit`, { answers: S.quizAnswers(quiz, { [mcq.id]: '2' }) })
  check('F4 a wrong attempt with blank questions (the app sends every question): 200, not passed, NO breakdown', wrong.status === 200 && wrong.data?.passed === false && S.correctionsOf(wrong.data).length === 0 && (wrong.data?.breakdown ?? []).length === 0, why(wrong))
  const recorded = await M.QuizAttemptModel.findOne({ userId: amal._id }).lean()
  check('F4b and that attempt was recorded, the blanks stored as ""', recorded?.answers?.[1]?.answer === '' && recorded?.passed === false, JSON.stringify(recorded?.answers))
  const right = await call('POST', `/quizzes/lessons/${quizL._id}/submit`, {
    answers: S.quizAnswers(quiz, { [mcq.id]: S.choicesOf(mcq)[0]!.value, [tf.id]: S.choicesOf(tf)[0]!.value, [short.id]: '  ask ' }),
  })
  check('F5 right answers by index (short answer trimmed, any case): passed, 100%', right.status === 200 && right.data?.passed === true && right.data?.scorePercent === 100, why(right))
  check('F6 a pass shows the corrections, with the explanation', S.correctionsOf(right.data).length === 3 && right.data.breakdown.some((b: any) => b.explanation === 'EUR/USD is the most traded.'))
  const qs = await call('GET', `/quizzes/lessons/${quizL._id}/summary`)
  check('F7 summary: 2 attempts, passed, best 100', qs.data?.attempts === 2 && qs.data?.passed === true && qs.data?.bestScore === 100, JSON.stringify(qs.data))

  /* ═══ G ═══ */
  section('G. Class assignments')
  const sub = await call('GET', '/class-assignments/submittable')
  const subs = Array.isArray(sub.data) ? sub.data.map(S.normalizeSubmittable) : []
  check('G1 the attended class is submittable, with a usable id (the API sends _id here)', sub.status === 200 && subs[0]?.id === String(lc._id) && subs[0]?.course?.title === 'Forex Foundations', JSON.stringify(sub.data?.[0]))
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
  check('G2 the app\'s own file check accepts this file', S.fileProblem({ mimeType: 'application/pdf', size: pdf.length }) === null)
  const form = new FormData()
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'homework.pdf')
  const up = await call('POST', '/uploads/document', undefined, form)
  if (up.data?.key) uploadedFiles.push(up.data.key)
  check('G3 multipart upload (the app\'s FormData): 201 with a URL', up.status === 201 && typeof up.data?.url === 'string', why(up))
  const fakeForm = new FormData()
  fakeForm.append('file', new Blob([Buffer.from('not a pdf at all')], { type: 'application/pdf' }), 'fake.pdf')
  const fake = await call('POST', '/uploads/document', undefined, fakeForm)
  check('G4 a file whose bytes are not what it claims is refused', fake.status === 400, why(fake))
  const fileRef = { url: up.data?.url, name: 'homework.pdf', mimeType: 'application/pdf', sizeBytes: up.data?.size ?? pdf.length }
  const s1 = await call('POST', '/class-assignments', { liveClassId: subs[0]?.id, title: 'Pip worksheet', files: [fileRef] })
  const a1 = s1.data ? S.normalizeAssignment(s1.data) : undefined
  check('G5 submit: 201/200, pending, attempt 1', (s1.status === 201 || s1.status === 200) && a1?.status === 'pending' && a1?.attempt === 1, why(s1))
  const list = await call('GET', '/class-assignments/me')
  const mineA = Array.isArray(list.data) ? list.data.map(S.normalizeAssignment) : []
  check('G6 it is in My assignments, with its class and course named', mineA.length === 1 && mineA[0]!.liveClass?.title === 'Live: pips in practice' && mineA[0]!.files.length === 1, JSON.stringify(list.data?.[0]?.liveClassId))
  const dup = await call('POST', '/class-assignments', { liveClassId: subs[0]?.id, title: 'Again', files: [fileRef] })
  check('G7 a second submission for the same class: 409', dup.status === 409, why(dup))
  await M.ClassAssignmentModel.updateOne({ _id: a1?.id }, { $set: { status: 'rejected', lastReason: 'Show your working' } })
  const rejected = (await call('GET', '/class-assignments/me')).data.map(S.normalizeAssignment)[0]
  check('G8 a rejected one carries the mentor\'s reason', rejected?.status === 'rejected' && rejected?.lastReason === 'Show your working', JSON.stringify(rejected))
  const rs = await call('POST', `/class-assignments/${a1?.id}/resubmit`, { note: 'Added working', files: [fileRef] })
  const a2 = rs.data ? S.normalizeAssignment(rs.data) : undefined
  check('G9 the revision: pending again, attempt 2', rs.status === 200 && a2?.status === 'pending' && a2?.attempt === 2, why(rs))

  /* ═══ H ═══ */
  section('H. A pending student')
  const pcall = await appSession('pending@app.local', 'b'.repeat(64))
  const pEn = await pcall('GET', '/enrollments/me')
  check('H1 still sees My learning', pEn.status === 200 && pEn.data?.length === 1, why(pEn))
  const pPr = await pcall('GET', '/courses/forex-foundations/progress')
  check('H2 /progress refuses them (the app does not ask, and shows "pending" instead)', pPr.status === 403, why(pPr))
  check('H3 the app\'s gate says pending for every lesson', S.lessonGate(detail.lessons[0]!, undefined, 'pending') === 'pending')
} catch (err) {
  check('suite crashed', false, (err as Error).stack ?? String(err))
} finally {
  /* Local-disk uploads made by G — remove them. */
  for (const key of uploadedFiles) {
    for (const root of [path.resolve('uploads'), path.resolve('public', 'uploads')]) {
      const f = path.join(root, key)
      if (f.startsWith(root) && fs.existsSync(f)) fs.rmSync(f)
    }
  }
  server.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
