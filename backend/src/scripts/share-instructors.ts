/* ─────────────────────────────────────────────────────────────
   Make every active mentor available to both academies — the same as
   ticking "Available to both organizations" on each one's Edit Instructor
   form (User.sharedAcrossOrgs).

   The mentor stays owned by their home academy; the other academy's admins
   can now see them and schedule classes for them. Logins, profiles and
   classes are untouched, and nothing is sent to anyone. The placeholder
   "Unassigned Instructor" accounts are skipped.

   Dry run by default — lists every mentor it would share. --apply writes,
   after saving their ids to share-instructors-backup-<ts>.json; --undo <file>
   unticks exactly those mentors again.

   Usage (from backend/):
     bun src/scripts/share-instructors.ts
     bun src/scripts/share-instructors.ts --apply
     bun src/scripts/share-instructors.ts --undo share-instructors-backup-<ts>.json
───────────────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import fs from 'node:fs'
import mongoose, { Types } from 'mongoose'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const UNDO = arg('--undo')

const { connectDatabase } = await import('@/config/database.ts')
await connectDatabase()
const M = await import('@/models/schema.ts')
const done = async (code: number) => { await mongoose.disconnect(); process.exit(code) }

if (UNDO) {
  const ids = (JSON.parse(fs.readFileSync(UNDO, 'utf8')) as { userIds: string[] }).userIds.map(id => new Types.ObjectId(id))
  const r = await M.UserModel.updateMany({ _id: { $in: ids }, role: 'instructor' }, { $set: { sharedAcrossOrgs: false } })
  console.log(`Unshared again: ${r.modifiedCount} of ${ids.length}.`)
  await done(0)
}

const orgs = await M.OrganizationModel.find().select('name').lean<Array<{ _id: Types.ObjectId; name: string }>>()
const orgName = new Map(orgs.map(o => [String(o._id), o.name]))

const filter = {
  role: 'instructor', isActive: { $ne: false }, sharedAcrossOrgs: { $ne: true },
  name: { $not: /^unassigned instructor$/i },
}
const mentors = await M.UserModel.find(filter).select('name email organizationId program category')
  .sort({ organizationId: 1, name: 1 })
  .lean<Array<{ _id: Types.ObjectId; name: string; email: string; organizationId?: Types.ObjectId; program?: string; category?: string }>>()

console.log(`\nActive mentors not yet available to both academies: ${mentors.length}\n`)
for (const u of mentors) {
  console.log(`  ${(orgName.get(String(u.organizationId)) ?? 'no academy').padEnd(18)} ${(u.program ?? u.category ?? '').padEnd(18)} ${u.name} <${u.email}>`)
}

if (!APPLY) {
  console.log('\nDry run — nothing changed. Re-run with --apply to share these mentors with both academies.')
  await done(0)
}

const backup = `share-instructors-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
fs.writeFileSync(backup, JSON.stringify({ at: new Date().toISOString(), userIds: mentors.map(u => String(u._id)) }, null, 2))
console.log(`\nBackup of the mentor ids: ${backup}`)
/* role: 'instructor' is in the filter again on purpose: the schema refuses
   sharedAcrossOrgs on any other role, and updateMany skips that validator. */
const r = await M.UserModel.updateMany({ _id: { $in: mentors.map(u => u._id) }, role: 'instructor' }, { $set: { sharedAcrossOrgs: true } })
console.log(`Shared with both academies: ${r.modifiedCount} of ${mentors.length}.`)
console.log(`Undo: bun src/scripts/share-instructors.ts --undo ${backup}`)
await done(0)
