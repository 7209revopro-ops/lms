/* ─────────────────────────────────────────────────────────────
   Preview the 9 PM "your schedule for tomorrow" email for ONE instructor.

   Uses the job's own schedule builder and the real template, so what this
   shows is exactly what the job would send.

   Default is READ-ONLY: it renders the email to an HTML file and prints the
   subject and items. Nothing is sent, nothing is logged, the instructor is
   never contacted.

     bun src/scripts/preview-instructor-schedule.ts --instructor someone@x.com
         [--date 2026-10-06]        schedule day (default: tomorrow in their academy)
         [--out path.html]          where to write it (default: .logs/emails/…, gitignored)
         [--send-to you@x.com]      ALSO email the preview to this address (never the instructor)
         [--allow-prod]             required with --send-to on a non-local database

   --send-to goes through the normal outbox, so it writes one EmailOutbox row
   to whichever database DATABASE_URL points at — hence the prod guard.
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const email = arg('instructor')?.toLowerCase().trim()
if (!email) {
  console.error('Usage: bun src/scripts/preview-instructor-schedule.ts --instructor <email> [--date YYYY-MM-DD] [--out file.html] [--send-to <address>] [--allow-prod]')
  process.exit(1)
}
const dateArg = arg('date')
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) { console.error('--date must be YYYY-MM-DD'); process.exit(1) }
const sendTo = arg('send-to')?.trim()

const DB_URL = process.env['DATABASE_URL']
if (!DB_URL) { console.error('DATABASE_URL is not set'); process.exit(1) }
const isLocal = /(localhost|127\.0\.0\.1)/.test(DB_URL)
if (sendTo && !isLocal && !flag('allow-prod')) {
  console.error('Refusing --send-to against a non-local database without --allow-prod (it writes an outbox row there).')
  process.exit(1)
}

await mongoose.connect(DB_URL)
try {
  const { UserModel } = await import('@/models/schema.ts')
  const { ensureOrgSlugs, orgSlugFor } = await import('@/utils/orgSlugs.ts')
  const { zoneForAcademy } = await import('@/utils/academyClock.ts')
  const { zoneDateKey, addDaysToDateKey, zoneDayBounds } = await import('@/utils/zoneDay.ts')
  const { buildScheduleFor } = await import('@/jobs/instructorSchedule.job.ts')
  const { renderInstructorDailySchedule, sendInstructorDailySchedule } = await import('@/services/email.service.ts')

  await ensureOrgSlugs().catch(() => {})

  const user = await UserModel.findOne({ email })
    .select('name email role isActive organizationId')
    .lean<{ _id: mongoose.Types.ObjectId; name?: string; email: string; role?: string; isActive?: boolean; organizationId?: unknown }>()
  if (!user) { console.error(`No user with email ${email}`); process.exit(1) }
  if (user.role !== 'instructor') console.warn(`⚠  ${email} has role "${user.role}" — the job only mails the instructor role; previewing anyway.`)
  if (user.isActive === false) console.warn(`⚠  ${email} is inactive — the job skips inactive accounts; previewing anyway.`)

  const slug = orgSlugFor(user.organizationId)
  const zone = zoneForAcademy(slug)
  const forDate = dateArg ?? addDaysToDateKey(zoneDateKey(new Date(), zone), 1)
  const { start, end } = zoneDayBounds(forDate, zone)

  const items = await buildScheduleFor(user._id, start, end)
  const name = user.name ?? 'Instructor'
  const { subject, html } = renderInstructorDailySchedule(name, start, items, slug)

  const out = resolve(arg('out') ?? `.logs/emails/preview-schedule-${email}-${forDate}.html`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, html)

  console.log(`Instructor : ${name} <${email}>  (${slug ?? 'default'} · ${zone})`)
  console.log(`Day        : ${forDate}  [${start.toISOString()} → ${end.toISOString()})`)
  console.log(`Subject    : ${subject}`)
  console.log(`Items      : ${items.length}`)
  for (const it of items) console.log(`  • ${it.start.toISOString()}  ${it.kind.padEnd(7)} ${it.title}`)
  console.log(`HTML       : ${out}`)

  if (sendTo) {
    await sendInstructorDailySchedule(sendTo, name, start, items, slug)
    console.log(`Sent preview to ${sendTo} (the instructor was NOT emailed).`)
  }
} finally {
  await mongoose.disconnect()
}
