/* ─────────────────────────────────────────────────────────────────────────
   Checks for the transport-error translator.  Run: npm run check:apiresponse

   The bug these come from reached production: the last step of registration
   showed "Failed to fetch" — Chrome's internal wording — to a student on a
   phone. Every engine words the same event differently, so a translator that
   only knows Chrome's phrasing leaves Safari and Firefox users reading
   something equally useless. Each wording below is the real string that
   engine produces, and the test is that NONE of them survives to the screen.
   ───────────────────────────────────────────────────────────────────────── */
import { describeTransportError, isTransportError, readJson } from '@/lib/apiResponse'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else    { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

const typeErr = (msg: string) => Object.assign(new TypeError(msg), { name: 'TypeError' })

console.log('\nA. Every engine\'s wording for "the request never completed"')
{
  const cases: [string, unknown][] = [
    ['Chrome / Edge', typeErr('Failed to fetch')],
    ['Safari',        typeErr('Load failed')],
    ['Firefox',       typeErr('NetworkError when attempting to fetch resource.')],
    ['axios XHR',     Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })],
  ]
  for (const [engine, err] of cases) {
    const out = describeTransportError(err)
    check(`A${cases.findIndex(c => c[0] === engine) + 1} ${engine} is translated`,
      out === 'We could not reach the server. Check your internet connection and try again.', String(out))
  }
  for (const [engine, err] of cases) {
    const out = describeTransportError(err) ?? ''
    check(`A· ${engine} does not quote the engine`,
      !/failed to fetch|load failed|networkerror|network error/i.test(out), out)
  }
}

console.log('\nB. Timeouts are their own sentence')
{
  const aborted = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
  const axiosTo = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })
  const domTo   = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })
  for (const [n, e] of [['B1 AbortError', aborted], ['B2 axios ECONNABORTED', axiosTo], ['B3 TimeoutError', domTo]] as [string, unknown][]) {
    const out = describeTransportError(e) ?? ''
    check(`${n} reads as slow, not broken`, /took too long/.test(out), out)
    check(`${n} does not leak the millisecond count`, !/\d{4,}ms/.test(out), out)
  }
}

console.log('\nC. A real API error is left alone')
{
  /* The whole point of returning null: a message the server chose says more
     than anything we could infer, so it must win. */
  check('C1 a plain Error is not a transport error', describeTransportError(new Error('Email already registered')) === null)
  check('C2 nor is a 4xx envelope', describeTransportError({ response: { status: 409 } }) === null)
  check('C3 nor is undefined', describeTransportError(undefined) === null)
  check('C4 nor is a string', describeTransportError('boom') === null)
  check('C5 isTransportError agrees', isTransportError(new Error('Email already registered')) === false
    && isTransportError(typeErr('Failed to fetch')) === true)
}

console.log('\nD. readJson still describes a response that IS there')
{
  const html = (status: number) => new Response('<!DOCTYPE html><h1>413</h1>', { status })
  ;(async () => {
    const r413 = await readJson(html(413))
    check('D1 a 413 HTML page becomes prose', !r413.ok && /too large/i.test(r413.message), JSON.stringify(r413))
    const r502 = await readJson(html(502))
    check('D2 a 502 HTML page becomes prose', !r502.ok && /not responding/i.test(r502.message), JSON.stringify(r502))
    const ok   = await readJson(new Response('{"success":true,"data":{"url":"u"}}', { status: 200 }))
    check('D3 real JSON still parses', ok.ok && (ok as { body: { data?: { url?: string } } }).body.data?.url === 'u')

    console.log(`\napiResponse.check — ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })()
}
