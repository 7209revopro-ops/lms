/* ─────────────────────────────────────────────────────────────
   Why is this person's photo not showing?

   An avatar falls back to a letter in three unrelated situations, and they
   look identical in the browser:

     1. no avatarUrl is stored at all — nobody ever uploaded one;
     2. one IS stored, but the object is not in the bucket the API reads,
        so /assets answers 404 and the <img> errors;
     3. one is stored and the object exists, but the response that carried it
        skipped the R2 rewrite, so the browser was handed a dead
        pub-*.r2.dev URL that 401s.

   Cause 3 is a code bug and is covered by asseturls.suite.ts. This script is
   for telling 1 and 2 apart in real data, which no test can do for you.

     bun src/scripts/diagnose-avatars.ts                # all instructors
     bun src/scripts/diagnose-avatars.ts --all          # every role
     bun src/scripts/diagnose-avatars.ts someone@x.com  # one person

   Read-only. It fetches each object to prove the proxy can actually serve it,
   so it is a little slow and worth pointing at one person when you can.
───────────────────────────────────────────────────────────── */
import 'dotenv/config'
import mongoose from 'mongoose'
import { UserModel } from '@/models/schema.ts'
import { toAssetUrl } from '@/utils/assetUrl.ts'
import { getObjectBytes, isR2Configured } from '@/services/r2.service.ts'
import { env } from '@/config/env.ts'

const args    = process.argv.slice(2)
const wantAll = args.includes('--all')
const target  = args.find(a => !a.startsWith('--'))

const uri = process.env['DATABASE_URL'] ?? process.env['MONGODB_URI']
if (!uri) {
  console.error('No DATABASE_URL / MONGODB_URI in the environment.')
  process.exit(1)
}

await mongoose.connect(uri)

try {
  const filter: Record<string, unknown> = target
    ? { email: target.toLowerCase().trim() }
    : wantAll ? {} : { role: 'instructor' }

  const users = await UserModel.find(filter)
    .select('name email role avatarUrl isActive')
    .sort({ name: 1 })
    .lean() as any[]

  if (!users.length) {
    console.log('\nNo matching accounts.\n')
    process.exit(0)
  }

  console.log(`\nR2 configured: ${isR2Configured() ? 'yes' : 'NO — /assets cannot serve anything'}`)
  console.log(`Bucket       : ${env.R2_BUCKET_NAME ?? '(unset)'}`)
  console.log(`Proxy base   : ${env.BACKEND_PUBLIC_URL}`)
  console.log(`Checking ${users.length} account(s)\n`)

  const noUrl: string[] = []
  const missing: string[] = []
  const ok: string[] = []
  const other: string[] = []

  for (const u of users) {
    const who = `${u.name ?? '(no name)'}  <${u.email}>`
    const raw = (u.avatarUrl ?? '').trim()

    /* 1 — nothing stored. The letter is correct behaviour, not a bug. */
    if (!raw) { noUrl.push(who); continue }

    /* Anything that is not an R2 URL is served by something else entirely —
       the local /uploads mount, or an external host. Report it rather than
       guessing, because those do not go through the proxy at all. */
    if (!raw.includes('.r2.dev')) {
      other.push(`${who}\n      stored: ${raw}`)
      continue
    }

    const proxied = String(toAssetUrl(raw))
    const key = decodeURIComponent(new URL(raw).pathname).replace(/^\/+/, '')

    /* 2 — the decisive check. Ask the bucket for the object the same way the
       /assets route will. A null here is exactly the 404 the browser gets. */
    const obj = await getObjectBytes(key)
    if (!obj) {
      missing.push(`${who}\n      key   : ${key}\n      serves: 404 — the object is not in ${env.R2_BUCKET_NAME}`)
    } else {
      ok.push(`${who}  (${obj.contentLength ?? obj.body.length} bytes)\n      ${proxied}`)
    }
  }

  const head = (t: string, n: number) => console.log(`\n${t}  [${n}]\n${'-'.repeat(t.length + 6)}`)

  if (ok.length) {
    head('WORKING — photo should render', ok.length)
    ok.forEach(l => console.log('  ' + l))
  }
  if (missing.length) {
    head('BROKEN — URL stored but the file is gone', missing.length)
    missing.forEach(l => console.log('  ' + l))
    console.log('\n  These show a letter because /assets cannot find the object.')
    console.log('  Either the file was never copied into this bucket during the')
    console.log('  public-to-private migration, or it was uploaded to a different')
    console.log('  one. Re-upload the photo from the admin panel to fix a single')
    console.log('  person; check the migration if the whole list is here.')
  }
  if (other.length) {
    head('NOT AN R2 URL — served by something else', other.length)
    other.forEach(l => console.log('  ' + l))
    console.log('\n  These bypass the /assets proxy. If they render, nothing to do.')
  }
  if (noUrl.length) {
    head('NO PHOTO UPLOADED — the letter is correct', noUrl.length)
    noUrl.forEach(l => console.log('  ' + l))
    console.log('\n  Nothing is broken for these. Add a photo in the admin panel.')
  }

  console.log(`\nSummary: ${ok.length} working, ${missing.length} broken, ` +
              `${other.length} non-R2, ${noUrl.length} without a photo\n`)
} finally {
  await mongoose.disconnect()
}
