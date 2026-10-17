import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiSuccess, CurrentUser, LoginAnswer, SessionAnswer, SessionTokens } from '@shared'
import { apiGet, apiPost, http, onSessionLost, session } from './http'
import { unregisterPush } from './push'

/* ─────────────────────────────────────────────────────────────
   Who is signed in, for the whole app. Screens never touch tokens: they call
   signInWithPassword / verifyCode / … and read `state`.

   Students only. A staff account signs in on the admin website; the API would
   refuse it most student routes anyway, so say so at the door.
───────────────────────────────────────────────────────────── */

export type AuthState =
  | { status: 'booting' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: CurrentUser }
  /* A stored session we could not check — no network at launch. Never shown as
     signed out: signing in again from a new state could look like a new device. */
  | { status: 'unreachable' }

export class NotAStudentError extends Error {
  constructor() { super('NOT_A_STUDENT') }
}

interface AuthApi {
  state: AuthState
  signInWithPassword(email: string, password: string): Promise<{ twoFactor: string } | void>
  completeTwoFactor(challengeToken: string, code: string): Promise<void>
  requestCode(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  /** Create a student account. Signed in at once — unless the server is set
   *  to verify the email first, which it reports instead of a session. */
  register(body: object, timeoutMs?: number): Promise<'signedIn' | 'verify'>
  /** A session handed back without the user (join / sign-in links). */
  signInWithTokens(tokens: SessionTokens): Promise<void>
  signOut(): Promise<void>
  /** Re-read the signed-in user (after editing the profile). */
  refreshUser(): Promise<void>
  /** Re-check the stored session (after `unreachable`). */
  retry(): void
}

const Ctx = createContext<AuthApi | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [state, setState] = useState<AuthState>({ status: 'booting' })

  /* Every way out of a session also stops this phone receiving its pushes. */
  const forget = useCallback(async () => {
    void unregisterPush()
    await session.clear()
    qc.clear()
    setState({ status: 'signedOut' })
  }, [qc])

  /* A session handed back by any sign-in route. */
  const adopt = useCallback(async (answer: SessionAnswer) => {
    if (answer.user.role !== 'student') {
      /* Do not keep a staff session in the app. */
      void apiPost('/auth/logout', { refreshToken: answer.tokens.refreshToken }).catch(() => {})
      throw new NotAStudentError()
    }
    await session.set(answer.tokens)
    setState({ status: 'signedIn', user: answer.user })
  }, [])

  /* Boot: a stored session is checked against the server once. */
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    void (async () => {
      const tokens = await session.load()
      if (!tokens) { if (alive) setState({ status: 'signedOut' }); return }
      try {
        const me = await apiGet<{ user: CurrentUser }>('/auth/me')
        if (!alive) return
        if (me.user.role === 'student') setState({ status: 'signedIn', user: me.user })
        else await forget()
      } catch (err) {
        if (!alive) return
        /* 401: the session is refused (the refresh logic already cleared it)
           → sign-in. No answer or a server error says nothing about the
           session: keep it and offer a retry. */
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 401) await forget()
        else setState({ status: 'unreachable' })
      }
    })()
    return () => { alive = false }
  }, [attempt, forget])

  useEffect(() => onSessionLost(() => { void unregisterPush(); qc.clear(); setState({ status: 'signedOut' }) }), [qc])

  const api = useMemo<AuthApi>(() => ({
    state,
    async signInWithPassword(email, password) {
      const answer = await apiPost<LoginAnswer>('/auth/login', { email: email.trim(), password, remember: true })
      if ('twoFactorRequired' in answer) return { twoFactor: answer.challengeToken }
      await adopt(answer)
    },
    async completeTwoFactor(challengeToken, code) {
      await adopt(await apiPost<SessionAnswer>('/auth/login/2fa', { challengeToken, code: code.trim() }))
    },
    async requestCode(email) {
      await apiPost('/auth/otp/request', { email: email.trim() })
    },
    async verifyCode(email, code) {
      await adopt(await apiPost<SessionAnswer>('/auth/otp/verify', { email: email.trim(), code: code.trim() }))
    },
    async register(body, timeoutMs) {
      const res = await http.post<ApiSuccess<SessionAnswer | { verificationRequired: true }>>('/auth/register', body, timeoutMs ? { timeout: timeoutMs } : undefined)
      const data = res.data.data
      if ('verificationRequired' in data) return 'verify'
      await adopt(data)
      return 'signedIn'
    },
    async signInWithTokens(tokens) {
      await session.set(tokens)
      try {
        const me = await apiGet<{ user: CurrentUser }>('/auth/me')
        await adopt({ user: me.user, tokens })
      } catch (err) {
        await forget()
        throw err
      }
    },
    async refreshUser() {
      const me = await apiGet<{ user: CurrentUser }>('/auth/me')
      if (me.user.role === 'student') setState({ status: 'signedIn', user: me.user })
    },
    async signOut() {
      const refreshToken = session.refreshToken()
      /* Best effort: the server revokes the token; signing out locally never waits on it. */
      if (refreshToken) void apiPost('/auth/logout', { refreshToken }).catch(() => {})
      await forget()
    },
    retry() {
      setState({ status: 'booting' })
      setAttempt(n => n + 1)
    },
  }), [state, adopt, forget])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
