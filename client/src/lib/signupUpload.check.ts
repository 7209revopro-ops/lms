/* ─────────────────────────────────────────────────────────────────────────
   Checks for the signup document uploader.  Run: npm run check:signupupload

   The policy being tested is the one that failed in production: three
   multi-megabyte uploads run back to back, on a phone, at the end of a
   four-screen form. What matters is what happens when one of them does not
   come back — and that is precisely what filling in the form by hand will
   almost never show you.
   ───────────────────────────────────────────────────────────────────────── */
import { uploadSignupDoc, ATTEMPTS, PHOTO_ATTEMPTS, UnreadableFileError, holdInMemory, __forgetUpload } from '@/lib/signupUpload'

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

console.log('\nG. The profile photo gets one more try than a document')
{
  let calls = 0
  const f = (async () => { calls++; if (calls < 3) throw dropped(); return ok('https://r2/photo.jpg') }) as unknown as typeof fetch
  const r = await grab(() => uploadSignupDoc(file('me.jpg'), 'photo', 'profile photo', { fetchImpl: f, sleep: nosleep }))
  check(`G1 a photo is tried ${PHOTO_ATTEMPTS} times and the third lands`, r.url === 'https://r2/photo.jpg' && calls === 3, `${calls} ${JSON.stringify(r)}`)
  let c2 = 0
  const f2 = (async () => { c2++; throw dropped() }) as unknown as typeof fetch
  await grab(() => uploadSignupDoc(file('doc.jpg'), 'kyc', 'passport copy', { fetchImpl: f2, sleep: nosleep }))
  check(`G2 a document still stops at ${ATTEMPTS}`, c2 === ATTEMPTS, String(c2))
  const waits: number[] = []
  let c3 = 0
  const f3 = (async () => { c3++; throw dropped() }) as unknown as typeof fetch
  await grab(() => uploadSignupDoc(file('me2.jpg'), 'photo', 'profile photo', { fetchImpl: f3, sleep: async ms => { waits.push(ms) } }))
  check('G3 the waits grow (2 s, then 5 s)', JSON.stringify(waits) === '[2000,5000]', JSON.stringify(waits))
}

console.log('\nH. A file the phone will no longer read: "choose it again", not "check your internet"')
{
  /* What Android hands back for a gallery file whose permission has gone:
     a File whose bytes cannot be read. */
  const gone = file('gone.jpg')
  ;(gone as unknown as { slice: () => Blob }).slice = () => ({ arrayBuffer: () => Promise.reject(new DOMException('NotReadableError', 'NotReadableError')) }) as unknown as Blob
  let calls = 0
  const f = (async () => { calls++; throw dropped() }) as unknown as typeof fetch
  let caught: unknown
  try { await uploadSignupDoc(gone, 'photo', 'profile photo', { fetchImpl: f, sleep: nosleep }) } catch (e) { caught = e }
  check('H1 it is an UnreadableFileError carrying the file', caught instanceof UnreadableFileError && (caught as UnreadableFileError).file === gone, String(caught))
  check('H2 nothing is sent for it', calls === 0, String(calls))
  const m = (caught as Error)?.message ?? ''
  check('H3 it says to choose it again, and names it', /choose it again/i.test(m) && /profile photo/.test(m) && !/internet/i.test(m), m)

  /* Readable at first, unreadable by the time every attempt has failed. */
  const fades = file('fades.jpg')
  let reads = 0
  const realSlice = fades.slice.bind(fades)
  ;(fades as unknown as { slice: (...a: unknown[]) => Blob }).slice = (...a: unknown[]) => {
    reads++
    if (reads > 1) return { arrayBuffer: () => Promise.reject(new Error('gone')) } as unknown as Blob
    return realSlice(...(a as []))
  }
  let c2 = 0
  const f2 = (async () => { c2++; throw dropped() }) as unknown as typeof fetch
  let caught2: unknown
  try { await uploadSignupDoc(fades, 'kyc', 'passport copy', { fetchImpl: f2, sleep: nosleep }) } catch (e) { caught2 = e }
  check('H4 after the attempts fail, an unreadable file is named as the cause', caught2 instanceof UnreadableFileError && c2 === ATTEMPTS, `${String(caught2)} ${c2}`)

  const held = await holdInMemory(file('keep.jpg'))
  check('H5 holdInMemory keeps name, type and size', held.name === 'keep.jpg' && held.type === 'image/jpeg' && held.size === 1024)
}

console.log(`\nsignupUpload.check — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
