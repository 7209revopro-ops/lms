/* ─────────────────────────────────────────────────────────────
   Registration gate (2026-10-31) — the client half of backend
   utils/registrationGate.ts.

   A buyer from /explore whose full registration form is still due
   (`user.registrationDue`) may browse, but booking, joining a class and
   opening lessons wait for the form. Whatever tries one of those — a button
   that knows up front, or a request the server refuses with
   403 REGISTRATION_REQUIRED (lib/axios) — asks for the same prompt here, and
   RegistrationRequiredSheet (mounted once in the dashboard layout) shows it.
───────────────────────────────────────────────────────────── */
export type GatedAction = 'book' | 'join' | 'lesson' | 'other'

export const REGISTRATION_REQUIRED = 'REGISTRATION_REQUIRED'
const EVENT = 'lms:registration-required'

export function showRegistrationRequired(action: GatedAction = 'other'): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<GatedAction>(EVENT, { detail: action }))
}

export function onRegistrationRequired(cb: (action: GatedAction) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<GatedAction>).detail ?? 'other')
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

/** The server's refusal for this rule — callers skip their own error toast for it (the sheet says it). */
export function isRegistrationRequired(err: unknown): boolean {
  return (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code === REGISTRATION_REQUIRED
}
