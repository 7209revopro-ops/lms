'use client'

/* ─────────────────────────────────────────────────────────────
   /p/<code> — a programme's shareable link (2026-10-17). Copied from the LMS
   admin's or the CS Portal's programme list and sent to anyone.
     · an LMS student on it: "Sign in" → their Class Schedule (Join is there)
     · anyone else: name, email, phone → the class's Join now button when it
       can be joined (15 minutes before it starts until it ends)
   Public in middleware.ts. GET /public/programs/:code, POST …/:code/join.
───────────────────────────────────────────────────────────── */
import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CalendarClock, MapPin, User, Video } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

interface PublicProgram {
  title: string; description: string; mentor: string; language: string; thumbnailUrl: string
  isOnline: boolean; location: string; status: 'active' | 'stopped'
  repeat: 'weekly' | 'monthly'; weekdays: number[]; monthDay: number | null; time: string; timezone: string
  nextClass: { id: string; startsAt: string; endsAt: string; joinable: boolean } | null
}
interface JoinAnswer {
  member: boolean
  nextClass?: { startsAt: string; endsAt: string; joinable: boolean } | null
  joinUrl?: string | null
  note?: string
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? fallback
const field = 'w-full rounded-xl border px-3.5 py-3 text-sm outline-none focus:ring-2'

export default function ProgramLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const [prog, setProg] = useState<PublicProgram | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [f, setF] = useState({ name: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [answer, setAnswer] = useState<JoinAnswer | null>(null)
  /* An LMS student already signed in and on this programme goes straight to Google Meet (2026-10-18), or
     to the class when it has no Meet link — no form, no sign-in page. */
  const [opening, setOpening] = useState(false)
  const [memberNoClass, setMemberNoClass] = useState(false)

  useEffect(() => {
    api.get<{ data: PublicProgram }>(`/public/programs/${encodeURIComponent(code)}`)
      .then(r => setProg(r.data.data))
      .catch(e => setLoadErr(errText(e, 'We could not open this link. Check your internet connection and try again.')))
    api.get<{ data: { signedIn: boolean; member: boolean; classId: string | null; meetUrl?: string | null } }>(`/public/programs/${encodeURIComponent(code)}/me`)
      .then(r => {
        const v = r.data.data
        if (!v.member) return
        if (v.meetUrl) { setOpening(true); window.location.replace(v.meetUrl) }
        else if (v.classId) { setOpening(true); window.location.replace(`/live-classes/${v.classId}/watch`) }
        else setMemberNoClass(true)
      })
      .catch(() => { /* signed out or offline — the page as it is */ })
  }, [code])
  /* Sign in once, then back to this link — which then opens the class. */
  const signInHref = `/login?method=email&from=${encodeURIComponent(`/p/${code}`)}`

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const r = await api.post<{ data: JoinAnswer }>(`/public/programs/${encodeURIComponent(code)}/join`, f)
      setAnswer(r.data.data)
      /* Straight to Google Meet once the form is in — any time, not only near class time (2026-10-18).
         Same tab: a new tab opened after an await is blocked as a popup on phones. */
      if (r.data.data.joinUrl) window.location.assign(r.data.data.joinUrl)
    } catch (e2) { setErr(errText(e2, 'Something went wrong — please try again.')) }
    finally { setBusy(false) }
  }

  const schedule = prog
    ? (prog.repeat === 'weekly' ? `Every ${prog.weekdays.map(d => DAYS[d]).join(', ')}` : `Monthly on day ${prog.monthDay ?? ''}`) + ` · ${prog.time} (${prog.timezone === 'Asia/Kolkata' ? 'India time' : 'Dubai time'})`
    : ''

  return (
    <div className="flex min-h-screen items-start justify-center px-4 py-8 sm:items-center" style={{ background: 'var(--color-bg-page)' }}>
      <div className="w-full max-w-[460px] overflow-hidden rounded-3xl bg-[var(--color-bg-surface)]"
        style={{ border: '1px solid var(--color-border)', boxShadow: '0 24px 80px rgba(13,15,26,0.08)' }}>
        {!prog && !loadErr && <div className="flex justify-center py-16"><Spinner size={24} /></div>}
        {loadErr && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <AlertCircle size={26} style={{ color: 'var(--color-danger)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{loadErr}</p>
          </div>
        )}
        {prog && (
          <>
            {prog.thumbnailUrl && <img src={prog.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />}
            <div className="space-y-4 p-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>Delta Institutions · Program</p>
                <h1 className="mt-1 text-xl font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{prog.title}</h1>
                {prog.description && <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{prog.description}</p>}
              </div>
              <div className="space-y-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {prog.mentor && <p className="flex items-center gap-2"><User size={14} />{prog.mentor}{prog.language && prog.language !== 'English' ? ` · ${prog.language}` : ''}</p>}
                <p className="flex items-center gap-2"><CalendarClock size={14} />{schedule}</p>
                <p className="flex items-center gap-2">{prog.isOnline ? <><Video size={14} />Online</> : <><MapPin size={14} />{prog.location || 'In person'}</>}</p>
                {prog.nextClass && <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>Next class: {when(prog.nextClass.startsAt)}{prog.nextClass.joinable ? ' — on now' : ''}</p>}
              </div>

              {opening ? (
                <div className="flex flex-col items-center gap-2 py-4"><Spinner size={22} /><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Opening your class…</p></div>
              ) : memberNoClass ? (
                <div className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--color-primary-light)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>You&apos;re on this program.</p>
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No class is coming up right now — your Class Schedule shows the next one.</p>
                  <Link href="/class-bookings" className="block rounded-xl py-3 text-center text-sm font-bold text-white" style={{ background: 'var(--color-primary)' }}>Open my Class Schedule</Link>
                </div>
              ) : prog.status !== 'active' ? (
                <p className="rounded-xl p-3 text-sm" style={{ background: 'var(--color-bg-inset)', color: 'var(--color-text-secondary)' }}>This program has ended.</p>
              ) : answer ? (
                answer.member && !answer.joinUrl ? (
                  <div className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--color-primary-light)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>You're on this program in the LMS.</p>
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Sign in once — this link then takes you straight into the class.</p>
                    <Link href={signInHref} className="block rounded-xl py-3 text-center text-sm font-bold text-white" style={{ background: 'var(--color-primary)' }}>Sign in</Link>
                  </div>
                ) : answer.joinUrl ? (
                  <div className="space-y-2.5">
                    <p className="text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>Opening Google Meet…</p>
                    {/* If the browser did not follow the redirect. */}
                    <a href={answer.joinUrl} className="block rounded-xl py-3.5 text-center text-base font-bold text-white" style={{ background: '#16a34a' }}>
                      Join on Google Meet
                    </a>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--color-bg-inset)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Thank you, {f.name.split(' ')[0]}!</p>
                    {answer.nextClass && <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>The class is on {when(answer.nextClass.startsAt)}.</p>}
                    {answer.note && <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{answer.note}</p>}
                  </div>
                )
              ) : (
                <>
                  <Link href={signInHref}
                    className="block rounded-xl border py-3 text-center text-sm font-semibold" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                    Have an LMS account? Sign in
                  </Link>
                  <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                    <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />or join with your details<span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
                  </div>
                  <form onSubmit={submit} className="space-y-2.5">
                    <input className={field} style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }}
                      placeholder="Your name" autoComplete="name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
                    <input className={field} style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }}
                      placeholder="Email" type="email" autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
                    <input className={field} style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }}
                      placeholder="Phone (WhatsApp) with country code, e.g. +971 50 123 4567" type="tel" autoComplete="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} required />
                    {err && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{err}</p>}
                    <button type="submit" disabled={busy} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-60" style={{ background: 'var(--color-primary)' }}>
                      {busy ? 'Please wait…' : 'Continue'}
                    </button>
                  </form>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
