/* The address a sign-in should start with, handed from one page of this tab to /login (2026-10-30:
   the /explore return page, whose buyer typed it at checkout). Kept in sessionStorage rather than
   the URL, so an email never lands in a link, the history or a server log. Read once. */
const KEY = 'lms_signin_email'

export function rememberSignInEmail(email: string): void {
  try { sessionStorage.setItem(KEY, email) } catch { /* private mode */ }
}

export function takeSignInEmail(): string {
  try {
    const v = sessionStorage.getItem(KEY) ?? ''
    sessionStorage.removeItem(KEY)
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : ''
  } catch { return '' }
}
