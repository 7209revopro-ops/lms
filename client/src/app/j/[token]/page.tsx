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
───────────────────────────────────────────────────────────── */
import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Clock, Video } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

type View =
  | { kind: 'working'; label: string }
  | { kind: 'wait'; until: number }
  | { kind: 'error'; title: string; message: string }

const errorOf = (err: unknown) =>
  (err as { response?: { status?: number; data?: { error?: { code?: string; message?: string; retryAfter?: number } } } })?.response

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

    const join = async (classId: string): Promise<void> => {
      setView({ kind: 'working', label: 'Opening your class…' })
      try {
        const res = await api.post<{ data: { url: string } }>(`/live-classes/${classId}/join`)
        window.location.replace(res.data.data.url)
      } catch (err) {
        const r = errorOf(err)
        const e = r?.data?.error
        if (r?.status === 425 && e?.retryAfter) {
          setView({ kind: 'wait', until: Date.now() + e.retryAfter * 1000 })
          timer = setTimeout(() => { void join(classId) }, e.retryAfter * 1000 + 500)
          return
        }
        /* 401: the session could not be renewed — the api client is already
           taking them to sign in, and back here afterwards. */
        if (r?.status === 401) return
        setView({ kind: 'error', title: "Can't open the class", message: e?.message ?? 'Something went wrong. Open the class from My Bookings.' })
      }
    }

    void (async () => {
      try {
        const res = await api.post<{ data: { liveClassId: string; inApp?: boolean } }>('/auth/join-link/redeem', { token })
        /* An in-app class has no meeting link: its watch page is the room. */
        if (res.data.data.inApp) { window.location.replace(`/live-classes/${res.data.data.liveClassId}/watch`); return }
        await join(res.data.data.liveClassId)
      } catch (err) {
        const e = errorOf(err)?.data?.error
        setView({ kind: 'error', title: 'Join link problem', message: e?.message ?? 'This join link is invalid or has expired.' })
      }
    })()
    return () => { if (timer) clearTimeout(timer) }
  }, [token])

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

  if (view.kind === 'working') return card(<Spinner size={24} />, view.label, 'This takes a moment.')

  if (view.kind === 'wait') {
    const secs = Math.max(0, Math.ceil((view.until - now) / 1000))
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0')
    return card(<Clock size={24} style={{ color: 'var(--color-primary)' }} />, 'Your class opens soon',
      <>It opens at <strong>{new Date(view.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong> — in {mm}:{ss}. Keep this page open; it will take you in.</>)
  }

  return card(<AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />, view.title, view.message,
    <>
      <Link href={`/login?method=email&from=${encodeURIComponent('/my-bookings')}`}
        className="rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ background: 'var(--color-primary)' }}>
        Sign in with an email code
      </Link>
      <Link href="/my-bookings" className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
        <Video size={14} />My Bookings
      </Link>
    </>)
}
