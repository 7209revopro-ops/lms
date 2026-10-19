/* ─────────────────────────────────────────────────────────────
   Class pods — the backfill (the user, 2026-10-18: "the current live
   sessions need a meeting room assigned too").

   Every online class from a day ago to 60 days on, taught by a Dubai mentor
   (not Moiz, not Akhil CP), gets an HRMS meeting pod — Pod 4, Pod 6–11 —
   never two in one pod (services/classPod.service.ts). The sweep that runs
   every minute does the same once deployed; this is for doing it now, and for
   seeing first what it would do.

   Usage (from backend/, on the server, with HRMS_API_URL, HRMS_CLIENT_ID,
   HRMS_INTEGRATION_SECRET and HRMS_ORG_ID set):
     bun src/scripts/class-pods-backfill.ts            dry run: what each class would get — nothing booked
     bun src/scripts/class-pods-backfill.ts --write    book them
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'

const write = process.argv.includes('--write')
const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const mongoose = (await import('mongoose')).default
const { planPodBackfill, runPodSweep, podsConfigured } = await import('@/services/classPod.service.ts')
const { LiveClassModel } = await import('@/models/schema.ts')

if (!podsConfigured()) {
  console.error('Pods are not configured: set HRMS_API_URL, HRMS_CLIENT_ID, HRMS_INTEGRATION_SECRET and HRMS_ORG_ID (and POD_SYNC not off).')
  process.exit(1)
}
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const plan = await planPodBackfill()
const count = (o: string) => plan.filter((p) => p.outcome === o).length
const skips = new Map<string, number>()
for (const p of plan) if (p.outcome === 'skip') skips.set(p.reason!, (skips.get(p.reason!) ?? 0) + 1)
for (const p of plan.filter((x) => x.outcome !== 'skip')) {
  const what = p.outcome === 'keeps' ? `keeps ${p.pod}` : p.outcome === 'gets' ? `gets ${p.pod}` : 'NO POD FREE'
  console.log(`${when(p.start)}  ${what.padEnd(14)}  ${p.title.slice(0, 50).padEnd(50)}  ${p.mentor}`)
}
console.log(`\n${plan.length} classes from a day ago to 60 days on: ${count('keeps')} keep their pod, ${count('gets')} get one, ${count('no_pod')} would find every pod taken.`)
console.log(`No pod needed: ${[...skips].map(([r, n]) => `${n} ${r}`).join(', ') || 'none'}.`)

if (!write) {
  console.log('\nDry run — nothing booked. Run again with --write to book them.')
  await mongoose.disconnect()
  process.exit(0)
}

// The sweep, until it has nothing left to do (it does at most 200 a run).
let rounds = 0, total = 0
for (;;) {
  const r = await runPodSweep(new Date(), 200)
  total += r.synced + r.released
  if (!r.synced || ++rounds >= 50) break
}
const booked = await LiveClassModel.countDocuments({ 'pod.state': 'booked', scheduledStart: { $gte: new Date(Date.now() - 864e5) } })
const noRoom = await LiveClassModel.find({ 'pod.state': 'no_room', scheduledStart: { $gte: new Date() } }).select('title scheduledStart').sort({ scheduledStart: 1 }).lean() as Array<{ title?: string; scheduledStart: Date }>
const failed = await LiveClassModel.countDocuments({ 'pod.state': 'error', scheduledStart: { $gte: new Date() } })
console.log(`\nDone: ${total} change(s). ${booked} classes hold a pod; ${noRoom.length} found every pod taken; ${failed} could not reach the HRMS (the sweep tries again).`)
for (const c of noRoom) console.log(`  no pod: ${when(c.scheduledStart.toISOString())}  ${c.title ?? 'Class'}`)
await mongoose.disconnect()
process.exit(0)
