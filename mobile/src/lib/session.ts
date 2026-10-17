import type { SessionTokens } from '@shared'

/* ─────────────────────────────────────────────────────────────
   The session's refresh logic, with its storage and transport injected so it
   can be tested without a phone or a server.

   ONE REFRESH AT A TIME. Five requests that all see 401 share one refresh:
   the server rotates the refresh token, so five parallel refreshes would mean
   four replays of a spent token — reuse — and every session of the account
   would be revoked.

   A DEADLINE. The 9 Oct join-link incident: a refresh with no timeout on a
   weak connection held every request queued behind it, and the screen spun.
   A refresh that does not answer in time fails like any other network error.

   ONLY A REFUSAL ENDS THE SESSION. 401 from /auth/refresh means the session
   is gone (expired, revoked, reused) — sign out. No answer, a timeout, a 5xx
   or a 429 says nothing about the session: keep the tokens and let the next
   request try again.
───────────────────────────────────────────────────────────── */

export interface TokenStore {
  read():  Promise<SessionTokens | null>
  write(t: SessionTokens): Promise<void>
  clear(): Promise<void>
}

/** Calls POST /auth/refresh; resolves to the new pair, rejects with the transport's error. */
export type RefreshCall = (refreshToken: string) => Promise<SessionTokens>

export type RefreshOutcome =
  | { ok: true;  tokens: SessionTokens }
  | { ok: false; sessionLost: boolean }

export function createSession(store: TokenStore, refreshCall: RefreshCall, onSessionLost: () => void) {
  let current: SessionTokens | null = null
  let inFlight: Promise<RefreshOutcome> | null = null

  const statusOf = (err: unknown) => (err as { response?: { status?: number } })?.response?.status

  async function doRefresh(): Promise<RefreshOutcome> {
    const tokens = current ?? await store.read()
    if (!tokens) return { ok: false, sessionLost: true }
    try {
      const next = await refreshCall(tokens.refreshToken)
      await store.write(next)
      current = next
      return { ok: true, tokens: next }
    } catch (err) {
      if (statusOf(err) === 401) {
        current = null
        await store.clear()
        onSessionLost()
        return { ok: false, sessionLost: true }
      }
      return { ok: false, sessionLost: false }
    }
  }

  return {
    async load(): Promise<SessionTokens | null> {
      current = await store.read()
      return current
    },
    async set(t: SessionTokens): Promise<void> {
      current = t
      await store.write(t)
    },
    async clear(): Promise<void> {
      current = null
      await store.clear()
    },
    accessToken: () => current?.accessToken ?? null,
    refreshToken: () => current?.refreshToken ?? null,
    /** Every caller during one refresh gets that refresh's outcome. */
    refresh(): Promise<RefreshOutcome> {
      if (!inFlight) inFlight = doRefresh().finally(() => { inFlight = null })
      return inFlight
    },
  }
}

export type Session = ReturnType<typeof createSession>
