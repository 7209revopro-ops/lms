import { create, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiSuccess, RefreshAnswer } from '@shared'
import { env } from './env'
import { getDeviceId, userAgent } from './device'
import { createSession } from './session'
import { clearTokens, readTokens, writeTokens } from './secureStore'

/* ─────────────────────────────────────────────────────────────
   The one HTTP client. Every request says it is the app (X-Client: mobile),
   which phone it is (X-Device-Id) and carries the access token as a Bearer —
   the server never sets a cookie for the app (plan.md §13.4 B1).
───────────────────────────────────────────────────────────── */

const TIMEOUT_MS = 15_000

/* Signed out from inside the client (the refresh was refused) — the auth
   provider subscribes and returns to the sign-in screen. */
const lostListeners = new Set<() => void>()
export function onSessionLost(fn: () => void): () => void {
  lostListeners.add(fn)
  return () => { lostListeners.delete(fn) }
}

async function appHeaders(): Promise<Record<string, string>> {
  return {
    'X-Client':    'mobile',
    'X-Device-Id': await getDeviceId(),
    'User-Agent':  userAgent(),
  }
}

/* A bare client for the refresh call itself — it must not run through the
   401 interceptor below, or a refused refresh would try to refresh. */
const bare = create({ baseURL: env.apiUrl, timeout: TIMEOUT_MS })

export const session = createSession(
  { read: readTokens, write: writeTokens, clear: clearTokens },
  async refreshToken => {
    const res = await bare.post<ApiSuccess<RefreshAnswer>>('/auth/refresh', { refreshToken }, { headers: await appHeaders() })
    return res.data.data.tokens
  },
  () => lostListeners.forEach(fn => fn()),
)

export const http = create({
  baseURL: env.apiUrl,
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use(async config => {
  Object.assign(config.headers, await appHeaders())
  const access = session.accessToken()
  if (access) config.headers.Authorization = `Bearer ${access}`
  return config
})

type Retried = InternalAxiosRequestConfig & { _retried?: boolean }

/* Sign-in endpoints answer 401 for a wrong password — that is not an expired
   session, and refreshing would be wrong. */
const NO_REFRESH = /\/auth\/(login|otp|refresh|logout|register|forgot-password|reset-password)/

http.interceptors.response.use(undefined, async (err: AxiosError) => {
  const config = err.config as Retried | undefined
  if (err.response?.status !== 401 || !config || config._retried || NO_REFRESH.test(config.url ?? '')) {
    throw err
  }
  config._retried = true
  const outcome = await session.refresh()
  if (!outcome.ok) throw err
  config.headers.Authorization = `Bearer ${outcome.tokens.accessToken}`
  return http(config)
})

/** GET that unwraps the { success, data } envelope. */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return (await http.get<ApiSuccess<T>>(url, { params })).data.data
}

/** POST that unwraps the { success, data } envelope. */
export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return (await http.post<ApiSuccess<T>>(url, body)).data.data
}
