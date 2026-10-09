'use client'

/* ─────────────────────────────────────────────────────────────
   /j/<code> — the Join button in a booked student's 5-minute and start-time
   reminders (email and WhatsApp).

   1. POST /auth/join-link/redeem — signs the student in if this browser has
      no session (no password), and answers which class the code is for.
   2. POST /live-classes/:id/join — the ordinary join: re-checks the seat and
      the window, records the join for attendance, hands back the meeting link.
   3. Straight into the meeting — or, for an in-app class, its watch page.

   Too early: a countdown, then it opens by itself. Anything else that stops
   it says why, with a way in that needs no password (an email code).
   Public in middleware.ts — the whole point is arriving signed out.

   NEVER A SPINNER WITHOUT AN END. A student on a weak connection once sat on
   "Signing you in…" for minutes: every step here could wait indefinitely, and
   a 401 from the join left the spinner up whenever the session refresh did not
   redirect. Now:
     · each call has its own deadline and is retried on a dropped connection or
       a gateway error (the redeem is safe to repeat — the same browser is
       signed in again, see auth.service redeemJoinLink);
     · every dead end becomes a message with a way forward;
     · the "taking too long?" links are in the server-rendered HTML and appear
       by CSS alone after a few seconds, so they show up even when this page's
       JavaScript never arrives.
───────────────────────────────────────────────────────────── */
import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Clock, RotateCw, Video } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

type View =
  | { kind: 'working'; label: string }
  | { kind: 'wait'; until: number }
  | { kind: 'error'; title: string; message: string }

type Failure = { status?: number; data?: { error?: { code?: string; message?: string; retryAfter?: number } } }
const errorOf = (err: unknown) => (err as { response?: Failure })?.response

const CALL_TIMEOUT_MS = 12_000
const RETRY_DELAYS_MS = [1_500, 3_500]
/* No answer at all (dropped, timed out), or a gateway/relay hiccup. A refusal
   with a reason (400/403/404/409/422/425) is final and shown as it is. */
const transient = (r: Failure | undefined) => !r || [408, 429, 500, 502, 503, 504].includes(r.status ?? 0)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function withRetry<T>(call: () => Promise<T>, onRetry: (attempt: number) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !transient(errorOf(err))) throw err
      onRetry(attempt + 2)
      await sleep(RETRY_DELAYS_MS[attempt]!)
    }
  }
}

const NETWORK_MESSAGE = 'We could not reach the server. Check your internet connection and try again.'

export default function JoinLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [view, setView] = useState<View>({ kind: 'working', label: 'Signing you in…' })
  const [now, setNow] = useState(() => Date.now())
  const ran = useRef(false)   // the code signs in once — guard StrictMode's double effect

  useEffect(() => {
    if (view.kind !== 'wait') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [view.kind])

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let gone = false

    const fail = (title: string, err: unknown, fallback: string) => {
      const r = errorOf(err)
      setView({ kind: 'error', title, message: r ? (r.data?.error?.message ?? fallback) : NETWORK_MESSAGE })
    }

    const join = async (classId: string): Promise<void> => {
      setView({ kind: 'working', label: 'Opening your class…' })
      try {
        const res = await withRetry(
          () => api.post<{ data: { url: string } }>(`/live-classes/${classId}/join`, undefined, { timeout: CALL_TIMEOUT_MS }),
          n => setView({ kind: 'working', label: `Opening your class… (try ${n})` }),
        )
        gone = true
        window.location.replace(res.data.data.url)
      } catch (err) {
        const r = errorOf(err)
        const e = r?.data?.error
        if (r?.status === 425 && e?.retryAfter) {
          setView({ kind: 'wait', until: Date.now() + e.retryAfter * 1000 })
          timer = setTimeout(() => { void join(classId) }, e.retryAfter * 1000 + 500)
          return
        }
        /* 401: the api client normally takes them to sign in (and back here).
           When it cannot — the refresh failed for a reason other than a dead
           session, or was rate-limited — nothing navigates, so say so rather
           than leave the spinner up. */
        if (r?.status === 401) {
          timer = setTimeout(() => {
            if (!gone) setView({ kind: 'error', title: 'Please sign in', message: 'Your session could not be restored. Sign in with a code sent to your email — you will come straight back to this class.' })
          }, 4_000)
          return
        }
        fail("Can't open the class", err, 'Something went wrong. Open the class from My Bookings.')
      }
    }

    void (async () => {
      try {
        const res = await withRetry(
          () => api.post<{ data: { liveClassId: string; inApp?: boolean } }>('/auth/join-link/redeem', { token }, { timeout: CALL_TIMEOUT_MS }),
          n => setView({ kind: 'working', label: `Signing you in… (try ${n})` }),
        )
        /* An in-app class has no meeting link: its watch page is the room. */
        if (res.data.data.inApp) { gone = true; window.location.replace(`/live-classes/${res.data.data.liveClassId}/watch`); return }
        await join(res.data.data.liveClassId)
      } catch (err) {
        fail('Join link problem', err, 'This join link is invalid or has expired.')
      }
    })()
    return () => { if (timer) clearTimeout(timer) }
  }, [token])

  const fromHere = encodeURIComponent(`/j/${token}`)
  /* Plain links — they work with or without this page's JavaScript. */
  const ways = (
    <>
      <a href={`/j/${token}`}
        className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ background: 'var(--color-primary)' }}>
        <RotateCw size={14} />Try again
      </a>
      <Link href={`/login?method=email&from=${fromHere}`} className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
        Sign in with an email code
      </Link>
      <Link href="/my-bookings" className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
        <Video size={14} />My Bookings
      </Link>
    </>
  )

  const card = (icon: React.ReactNode, title: string, body: React.ReactNode, actions?: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center px-6 py-10" style={{ background: 'var(--color-bg-page)' }}>
      <div className="w-full max-w-[420px] rounded-3xl bg-[var(--color-bg-surface)] p-8 text-center"
        style={{ border: '1px solid var(--color-border)', boxShadow: '0 24px 80px rgba(13,15,26,0.08)' }}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}>{icon}</div>
        <p className="mt-4 text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>{title}</p>
        <div className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>{body}</div>
        {actions && <div className="mt-5 flex flex-col items-center gap-2">{actions}</div>}
      </div>
    </div>
  )

  if (view.kind === 'working') {
    return card(<Spinner size={24} />, view.label, (
      <>
        This takes a moment.
        {/* Revealed by CSS after 10 s — no JavaScript needed, so it appears
            even if the page never finishes loading. */}
        <style>{'@keyframes jlReveal{to{opacity:1;visibility:visible}}.jl-late{opacity:0;visibility:hidden;animation:jlReveal .3s ease-out 10s forwards}'}</style>
        <div className="jl-late mt-5 flex flex-col items-center gap-2">
          <p className="text-xs">Taking longer than usual? Your connection may be slow.</p>
          {ways}
        </div>
      </>
    ))
  }

  if (view.kind === 'wait') {
    const secs = Math.max(0, Math.ceil((view.until - now) / 1000))
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0')
    return card(<Clock size={24} style={{ color: 'var(--color-primary)' }} />, 'Your class opens soon',
      <>It opens at <strong>{new Date(view.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong> — in {mm}:{ss}. Keep this page open; it will take you in.</>)
  }

  return card(<AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />, view.title, view.message, ways)
}
