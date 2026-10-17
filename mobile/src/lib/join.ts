import { Linking } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { problemOf, type ApiSuccess, type HandoffResult, type JoinClassResult } from '@shared'
import { http } from './http'
import i18n from '@/i18n'

/* ─────────────────────────────────────────────────────────────
   Getting into a class — the same two server calls as the website:

   · Google Meet (external): POST /live-classes/:id/join re-checks the seat and
     the window, RECORDS THE JOIN for attendance, and releases the Meet link for
     this tap only. Opened with Linking, so the Meet app takes it when installed.
   · Interactive room (LiveKit via the meeting platform): POST …/handoff gives a
     single-use address; opened in an in-app browser so the student comes back
     to the app when they close it (plan.md §13.7).

   Each returns what to tell the student; the server's sentences are used
   wherever it gave one.
───────────────────────────────────────────────────────────── */

export type JoinOutcome =
  | { ok: true }
  | { ok: false; message: string; retryAfter?: number }

const waitText = (secs: number) => {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60), s = secs % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function refusal(err: unknown, fallback: string): JoinOutcome {
  const p = problemOf(err)
  if (p.kind === 'offline') return { ok: false, message: i18n.t('common.offline') }
  if (p.kind === 'timeout') return { ok: false, message: i18n.t('common.timeout') }
  if (p.code === 'TOO_EARLY') {
    const secs = Number((err as { response?: { data?: { error?: { retryAfter?: number } } } })?.response?.data?.error?.retryAfter ?? 0)
    return { ok: false, message: secs > 0 ? i18n.t('join.opensIn', { wait: waitText(secs) }) : i18n.t('join.notOpen'), retryAfter: secs || undefined }
  }
  if (p.code === 'NOT_BOOKED') return { ok: false, message: i18n.t('join.notBooked') }
  return { ok: false, message: p.message || fallback }
}

export async function joinMeet(liveClassId: string): Promise<JoinOutcome> {
  try {
    const { data } = await http.post<ApiSuccess<JoinClassResult>>(`/live-classes/${liveClassId}/join`)
    await Linking.openURL(data.data.url)
    return { ok: true }
  } catch (err) {
    return refusal(err, i18n.t('join.linkFailed'))
  }
}

export async function enterRoom(liveClassId: string): Promise<JoinOutcome> {
  try {
    const { data } = await http.post<ApiSuccess<HandoffResult>>(`/live-classes/${liveClassId}/handoff`, {})
    if (!data.data.url) return { ok: false, message: i18n.t('join.noPlatform') }
    await WebBrowser.openBrowserAsync(data.data.url, { showTitle: true, enableBarCollapsing: true })
    return { ok: true }
  } catch (err) {
    return refusal(err, i18n.t('join.roomFailed'))
  }
}
