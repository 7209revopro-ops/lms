/* ─────────────────────────────────────────────────────────────
   The API's envelope — CLAUDE.md "API contract". Every response is one of:
     { success: true,  data, meta? }
     { success: false, error: { code, message } }
───────────────────────────────────────────────────────────── */

export interface ApiSuccess<T> {
  success: true
  data:    T
  message?: string
  meta?:   Record<string, unknown>
}

export interface ApiFailure {
  success: false
  error:   { code: string; message: string; details?: unknown; retryAfter?: number }
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure

/** What went wrong with a request, in the three shapes a caller acts on. */
export type RequestProblem =
  | { kind: 'refused'; status: number; code: string; message: string }  // the server answered with a reason
  | { kind: 'offline' }                                                  // no answer at all
  | { kind: 'timeout' }                                                  // gave up waiting

/** Normalise an axios-style error into a RequestProblem — no axios import needed. */
export function problemOf(err: unknown): RequestProblem {
  const e = err as {
    code?: string
    response?: { status?: number; data?: Partial<ApiFailure> }
  }
  if (e?.response) {
    const status = e.response.status ?? 0
    const body = e.response.data?.error
    return {
      kind: 'refused',
      status,
      code: body?.code ?? `HTTP_${status}`,
      message: body?.message ?? 'Something went wrong. Please try again.',
    }
  }
  if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') return { kind: 'timeout' }
  return { kind: 'offline' }
}
