import { createSession, type TokenStore } from '../lib/session'
import type { SessionTokens } from '@shared'

/* The refresh rules (src/lib/session.ts): one refresh at a time, only a 401
   ends the session, a network failure keeps it. */

function memoryStore(initial: SessionTokens | null): TokenStore & { value: SessionTokens | null } {
  const s = {
    value: initial,
    read: async () => s.value,
    write: async (t: SessionTokens) => { s.value = t },
    clear: async () => { s.value = null },
  }
  return s
}
const pair = (n: number): SessionTokens => ({ accessToken: `a${n}`, refreshToken: `r${n}` })
const refused = (status: number) => Object.assign(new Error('refused'), { response: { status } })

describe('session refresh', () => {
  it('five simultaneous refreshes make ONE call and all get its tokens', async () => {
    const store = memoryStore(pair(1))
    let calls = 0
    const s = createSession(store, async () => { calls++; await new Promise(r => setTimeout(r, 10)); return pair(2) }, () => {})
    await s.load()
    const outcomes = await Promise.all([s.refresh(), s.refresh(), s.refresh(), s.refresh(), s.refresh()])
    expect(calls).toBe(1)
    expect(outcomes.every(o => o.ok && o.tokens.accessToken === 'a2')).toBe(true)
    expect(store.value).toEqual(pair(2))
    expect(s.accessToken()).toBe('a2')
  })

  it('presents the CURRENT refresh token, not the one it booted with', async () => {
    const seen: string[] = []
    const s = createSession(memoryStore(pair(1)), async rt => { seen.push(rt); return pair(seen.length + 1) }, () => {})
    await s.load()
    await s.refresh()
    await s.refresh()
    expect(seen).toEqual(['r1', 'r2'])
  })

  it('a 401 from refresh ends the session: tokens cleared, listener told', async () => {
    const store = memoryStore(pair(1))
    const lost = jest.fn()
    const s = createSession(store, async () => { throw refused(401) }, lost)
    await s.load()
    const o = await s.refresh()
    expect(o).toEqual({ ok: false, sessionLost: true })
    expect(store.value).toBeNull()
    expect(s.accessToken()).toBeNull()
    expect(lost).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no answer at all', Object.assign(new Error('Network Error'), {})],
    ['a timeout', Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })],
    ['a server error', refused(502)],
    ['rate limiting', refused(429)],
  ])('%s keeps the session for the next try', async (_label, err) => {
    const store = memoryStore(pair(1))
    const lost = jest.fn()
    const s = createSession(store, async () => { throw err }, lost)
    await s.load()
    const o = await s.refresh()
    expect(o).toEqual({ ok: false, sessionLost: false })
    expect(store.value).toEqual(pair(1))
    expect(lost).not.toHaveBeenCalled()
  })

  it('a later refresh after one finished makes a new call', async () => {
    let calls = 0
    const s = createSession(memoryStore(pair(1)), async () => pair(++calls + 1), () => {})
    await s.load()
    await s.refresh()
    await s.refresh()
    expect(calls).toBe(2)
  })

  it('with no stored session, refresh reports it lost without calling the server', async () => {
    const call = jest.fn()
    const s = createSession(memoryStore(null), call, () => {})
    await s.load()
    expect(await s.refresh()).toEqual({ ok: false, sessionLost: true })
    expect(call).not.toHaveBeenCalled()
  })
})
