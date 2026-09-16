'use client'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '@/lib/axios'
import { useToast } from '@/store/ui.store'

export interface JoinClassResult {
  url:      string   // the Google Meet URL, released for this click only
  closesAt: string   // ISO — when the window shuts
}

/** "Opens in 3m 20s", not "Opens in 200s" — and not "Opens in 1800s" after
 *  an admin has just moved the class. */
function fmtWait(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60), s = secs % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/**
 * useJoinClass — fetch the Meet link for a session and open it in a new tab.
 *
 * The link is never in any list payload; it comes back from
 * POST /live-classes/:id/join, which re-checks the booking and the window at
 * the moment of the click. Errors map to the app's toasts.
 *
 * Popup safety: browsers only honour window.open inside the synchronous part
 * of a user gesture. A tab opened AFTER the awaited request is treated as a
 * popup and blocked, so the tab is opened first — with a line of text in it,
 * so it does not look like a misfire while the request runs — and pointed at
 * the URL once the response lands; on failure it is closed again.
 *
 * Two fallbacks, and they are different cases:
 *   · window.open returned null (the browser refused the tab outright): the
 *     current tab navigates instead. There is no other way to get them in.
 *   · the student CLOSED the blank tab while the request was in flight: that
 *     is a change of mind, not a blocked popup. Navigating the LMS tab away
 *     from under them would be the opposite of what they just did, so the
 *     link is dropped and they are told to click again.
 */
export function useJoinClass(sessionId: string) {
  const toast = useToast()
  const qc    = useQueryClient()
  const [isJoining, setIsJoining] = useState(false)
  const inFlight = useRef(false)

  const join = async (): Promise<boolean> => {
    if (inFlight.current || typeof window === 'undefined') return false
    inFlight.current = true
    setIsJoining(true)

    /* No 'noopener' in the features string on purpose: with it, window.open
       returns null and the handle needed to redirect the tab is lost. The
       same protection is applied by hand (opener = null) before the tab is
       pointed anywhere. */
    const tab = window.open('', '_blank')
    if (tab) {
      try {
        tab.opener = null
        tab.document.title = 'Opening Google Meet…'
        tab.document.body.innerHTML =
          '<p style="font:15px system-ui;color:#555;padding:24px">Opening Google Meet…</p>'
      } catch { /* cross-origin guard; nothing to do */ }
    }

    try {
      const { url } = await apiPost<JoinClassResult>(`/live-classes/${sessionId}/join`)
      if (!tab) {
        window.location.assign(url)
      } else if (tab.closed) {
        toast.info('The Meet tab was closed before the link arrived — press Join again.')
        return false
      } else {
        tab.location.href = url
      }
      return true
    } catch (e: any) {
      try { tab?.close() } catch { /* already gone */ }

      const err  = e?.response?.data?.error
      const code = err?.code as string | undefined
      if (code === 'TOO_EARLY') {
        /* The body carries retryAfter; the Retry-After HEADER is not exposed
           through CORS, so it is not relied on. A large wait usually means
           the class was just rescheduled under a stale row — refresh the
           rows so the page stops showing a button that cannot work. */
        const secs = Number(err?.retryAfter ?? 0)
        toast.info(secs > 0 ? `Opens in ${fmtWait(secs)}` : 'The join link is not open yet')
        if (secs > 60) void qc.invalidateQueries({ queryKey: ['live-classes'] })
      } else if (code === 'JOIN_WINDOW_CLOSED') {
        /* The server's message carries the real grace period. */
        toast.error(err?.message ?? 'The join link has closed.')
        void qc.invalidateQueries({ queryKey: ['live-classes'] })
      } else if (code === 'NOT_BOOKED') {
        toast.error('You have not booked this class')
      } else {
        toast.error(err?.message ?? 'Could not open the class link. Please try again.')
      }
      return false
    } finally {
      inFlight.current = false
      setIsJoining(false)
    }
  }

  return { join, isJoining }
}
