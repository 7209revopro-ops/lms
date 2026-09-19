/* ─────────────────────────────────────────────────────────────────────────
   Checks for the signup document uploader.  Run: npm run check:signupupload

   The policy being tested is the one that failed in production: three
   multi-megabyte uploads run back to back, on a phone, at the end of a
   four-screen form. What matters is what happens when one of them does not
   come back — and that is precisely what filling in the form by hand will
   almost never show you.
   ───────────────────────────────────────────────────────────────────────── */
import { uploadSignupDoc, ATTEMPTS, __forgetUpload } from '@/lib/signupUpload'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else    { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

const file = (name = 'passport.jpg') => new File([new Uint8Array(1024)], name, { type: 'image/jpeg' })
const ok   = (url = 'https://r2/x.jpg') =>
  new Response(JSON.stringify({ success: true, data: { url } }), { status: 200 })
const dropped = () => Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' })
const nosleep = async () => {}

async function grab(fn: () => Promise<string>): Promise<{ url?: string; err?: string }> {
  try { return { url: await fn() } } catch (e) { return { err: (e as Error).message } }
}

console.log('\nA. A dropped connection is retried once, and succeeds')
{
  let calls = 0
  const f = (async () => { calls++; if (calls === 1) throw dropped(); return ok() }) as unknown as typeof fetch
  const r = await grab(() => uploadSignupDoc(file(), 'kyc', 'passport copy', { fetchImpl: f, sleep: nosleep }))
  check('A1 the upload succeeds on the second attempt', r.url === 'https://r2/x.jpg', JSON.stringify(r))
  check('A2 and it really did take two attempts', calls === 2, String(calls))
}

console.log('\nB. Two drops gives up, in words a student can act on')
{
  let calls = 0
  const f = (async () => { calls++; throw dropped() }) as unknown as typeof fetch
  const r = await grab(() => uploadSignupDoc(file(), 'kyc', 'passport copy', { fetchImpl: f, sleep: nosleep }))
  check(`B1 stops at ATTEMPTS (${ATTEMPTS})`, calls === ATTEMPTS, String(calls))
  check('B2 the browser\'s own words never reach the student',
    !!r.err && !/failed to fetch/i.test(r.err), r.err)
  check('B3 it names the document that failed', !!r.err && /passport copy/i.test(r.err), r.err)
  check('B4 it says the finished uploads are kept', !!r.err && /already uploaded is kept/i.test(r.err), r.err)
  check('B5 it says what to do next', !!r.err && /Submit again/i.test(r.err), r.err)
}

console.log('\nC. A RESPONSE is an answer — never re-send three megabytes for it')
{
  for (const [label, status, body] of [
    ['C1 413 too large', 413, '<!DOCTYPE html><h1>413</h1>'],
    ['C2 429 rate limited', 429, JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts.' } })],
    ['C3 500 server error', 500, JSON.stringify({ success: false, error: { message: 'boom' } })],
    ['C4 400 wrong file type', 400, JSON.stringify({ success: false, error: { message: 'File contents do not match the declared document type.' } })],
  ] as [string, number, string][]) {
    let calls = 0
    const f = (async () => { calls++; return new Response(body, { status }) }) as unknown as typeof fetch
    const r = await grab(() => uploadSignupDoc(file(), 'kyc', 'passport copy', { fetchImpl: f, sleep: nosleep }))
    check(`${label} is not retried`, calls === 1, `${calls} calls`)
    check(`${label} still explains itself`, !!r.err && r.err.length > 10, r.err)
    /* A 5xx body is an internal string. Whatever it says, the student must
       not read it. */
    if (status >= 500) {
      check(`${label} does not quote the server's internals`,
        !!r.err && !/boom/.test(r.err) && /try again/i.test(r.err), r.err)
    }
  }
  /* The 413 arrives as an nginx HTML page, not the API envelope — readJson
     has to turn the STATUS into the sentence. */
  let c = 0
  const f413 = (async () => { c++; return new Response('<!DOCTYPE html>', { status: 413 }) }) as unknown as typeof fetch
  const r = await grab(() => uploadSignupDoc(file(), 'kyc', 'passport copy', { fetchImpl: f413, sleep: nosleep }))
  check('C5 an HTML 413 reads as "too large", not as a parser error',
    !!r.err && /too large/i.test(r.err) && !/JSON|token/i.test(r.err), r.err)
}

console.log('\nD. A file already uploaded is never sent twice')
{
  const f1 = file('reuse.jpg')
  let calls = 0
  const f = (async () => { calls++; return ok('https://r2/reuse.jpg') }) as unknown as typeof fetch
  await uploadSignupDoc(f1, 'kyc', 'passport copy', { fetchImpl: f, sleep: nosleep })
  const again = await grab(() => uploadSignupDoc(f1, 'kyc', 'passport copy', { fetchImpl: f, sleep: nosleep }))
  check('D1 the second call is served from cache', calls === 1, `${calls} calls`)
  check('D2 and returns the same reference', again.url === 'https://r2/reuse.jpg', JSON.stringify(again))
  __forgetUpload(f1)
}

console.log('\nE. Each attempt carries a fresh body')
{
  /* A FormData holding a File can only be sent once; re-using it after a
     failure sends an EMPTY body, which the server accepts as a malformed
     upload rather than failing loudly. */
  const seen: boolean[] = []
  let calls = 0
  const f = (async (_u: string, init?: RequestInit) => {
    calls++
    const fd = init?.body as FormData
    seen.push(fd instanceof FormData && fd.get('file') instanceof File)
    if (calls === 1) throw dropped()
    return ok()
  }) as unknown as typeof fetch
  await grab(() => uploadSignupDoc(file(), 'kyc', 'passport copy', { fetchImpl: f, sleep: nosleep }))
  check('E1 both attempts carried the file', seen.length === 2 && seen.every(Boolean), JSON.stringify(seen))
}

console.log('\nF. Each attempt is given a deadline')
{
  const signals: (AbortSignal | undefined)[] = []
  const f = (async (_u: string, init?: RequestInit) => {
    signals.push(init?.signal ?? undefined)
    return ok()
  }) as unknown as typeof fetch
  await grab(() => uploadSignupDoc(file(), 'kyc', 'passport copy', { fetchImpl: f, sleep: nosleep }))
  check('F1 an AbortSignal is attached', signals[0] instanceof AbortSignal)

  /* A stall with no response at all: without a deadline this hangs forever,
     which is what left the Submit button spinning. */
  const stall = (async (_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })) as unknown as typeof fetch
  const r = await grab(() => uploadSignupDoc(file(), 'kyc', 'passport copy', { fetchImpl: stall, sleep: nosleep }))
  check('F2 a stalled request ends rather than hanging', !!r.err, JSON.stringify(r))
  check('F3 and reads as slow, not broken', !!r.err && /took too long/i.test(r.err), r.err)
}

console.log(`\nsignupUpload.check — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
