/* ─────────────────────────────────────────────────────────────────────────
   Uploading a signup document.

   Extracted from RegisterForm because the interesting part of it is a
   NETWORK POLICY — when to wait, when to retry, when to give up and what to
   say — and none of that is React. Left inside the component it could only
   be exercised by filling in four screens of form, which is exactly why it
   went to production untested and put "Failed to fetch" in front of a
   student on a phone.

   POST /uploads/signup-doc is the one upload with no session behind it: the
   full signup collects a passport, an ID document and a profile photo BEFORE
   the account exists (M-05), and passes the returned references into the
   register payload.
   ───────────────────────────────────────────────────────────────────────── */
import { readJson, describeStatus, describeTransportError, isTransportError } from '@/lib/apiResponse'

/** Reuse what this exact file already stored. Registration can fail after the
    uploads succeed — a taken email is the common case — and without this
    every retry would send all three files again, burn through the hourly
    limit, and leave more orphans behind each time. Keyed on the File object,
    so picking a different file re-uploads. */
const uploadedSignupDocs = new WeakMap<File, string>()

/** A per-attempt deadline. `fetch` has NO timeout of its own, so a stalled
    mobile connection would otherwise leave the Submit button spinning until
    the student gave up. Generous, because this is an uplink carrying up to
    3 MB from a phone. */
export const ATTEMPT_TIMEOUT_MS = 45_000

/** ONE retry, not three. Attempts are counted in FILES against the 45/hour
    signup-upload bucket, so two attempts per file is at most six requests per
    submit — enough to ride out a dropped connection, and little enough that
    the budget survives for the genuine second try a student may still need. */
export const ATTEMPTS = 2

const RETRY_DELAY_MS = 1200

export interface UploadDeps {
  fetchImpl?: typeof fetch
  sleep?:     (ms: number) => Promise<void>
}

/**
 * Upload one signup document and return its stored reference.
 *
 * Retries ONLY when nothing came back. A response — any response, including
 * 413, 429 and 500 — is an answer, and re-sending three megabytes to be told
 * the same thing again helps nobody and spends the student's upload budget.
 *
 * @param label  what to call this document in an error the student reads;
 *               three are sent in a row and "upload failed" does not say which.
 */
export async function uploadSignupDoc(
  file: File,
  kind: 'kyc' | 'photo' = 'kyc',
  label = 'document',
  deps: UploadDeps = {},
): Promise<string> {
  const cached = uploadedSignupDocs.get(file)
  if (cached) return cached

  const doFetch = deps.fetchImpl ?? fetch
  const sleep   = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))

  let lastErr: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    /* AbortController rather than AbortSignal.timeout: this page is the first
       thing a new student loads, on whatever phone they own, and the static
       method is too new to assume. */
    const ac    = new AbortController()
    const timer = setTimeout(() => ac.abort(), ATTEMPT_TIMEOUT_MS)

    /* Rebuilt per attempt. A FormData carrying a File can only be sent once —
       the body is a stream, and re-using it after a failure sends an empty
       body, which the server would accept as a malformed upload rather than
       fail loudly. */
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)

    let res: Response
    try {
      res = await doFetch('/api/v1/uploads/signup-doc', { method: 'POST', body: fd, signal: ac.signal })
    } catch (err) {
      lastErr = err
      if (!isTransportError(err) || attempt === ATTEMPTS) break
      await sleep(RETRY_DELAY_MS)
      continue
    } finally {
      clearTimeout(timer)
    }

    /* Read the body defensively. This request carries megabytes through a
       reverse proxy, which is the one place in the whole signup that can
       answer with an HTML error page instead of the API envelope — a 413 when
       the body is over nginx's client_max_body_size, a 502 while the backend
       restarts. `await res.json()` threw on that HTML before `res.ok` was
       ever consulted, and the browser's own parser message was what the
       student was shown: "Unexpected token '<'" in Chrome, "The string did
       not match the expected pattern." in Safari. */
    const read = await readJson<{ url: string }>(res)
    if (!read.ok) throw new Error(`${read.message} (${label})`)
    /* A 4xx message is copy the API wrote FOR the student — "File contents do
       not match the declared document type." tells them exactly what to fix,
       and nothing we could substitute would be better. A 5xx message is an
       internal error string that happened to be serialised; it names our
       plumbing, not their problem. So the status speaks for the server and
       the API speaks for itself. */
    if (!res.ok) {
      /* Three documents go up in a row, so a refusal must say WHICH: "Only
         JPEG, PNG, WebP images or PDF documents are allowed" on its own sent
         students back to the passport on step 2 when it was the profile
         photo on step 1. */
      throw new Error(res.status >= 500
        ? describeStatus(res.status)
        : `Your ${label} was refused — ${(read.body.error?.message ?? 'please choose a different file').replace(/\.$/, '')}.`)
    }

    const url = read.body.data?.url
    if (!url) throw new Error(`Your ${label} uploaded but no file reference came back. Please try again.`)
    uploadedSignupDocs.set(file, url)
    return url
  }

  /* Every attempt failed before a response arrived. Name the document, and
     say the finished ones are kept — the next tap really is cheaper, and
     nothing on screen would otherwise suggest it. */
  const why = describeTransportError(lastErr) ?? 'The upload did not complete.'
  throw new Error(
    `${why.replace(/\.$/, '')} — your ${label} did not finish uploading. ` +
    'Anything already uploaded is kept, so tapping Submit again will resume where it stopped.',
  )
}

/** Testing seam: forget what this file uploaded. Not used by the app. */
export const __forgetUpload = (file: File) => uploadedSignupDocs.delete(file)
