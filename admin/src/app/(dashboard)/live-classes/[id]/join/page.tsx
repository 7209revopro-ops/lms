'use client'

/* ─────────────────────────────────────────────────────────────
   /live-classes/<id>/join — where a mentor's WhatsApp "Start class" button
   lands (mentor_class_in_10_min, sent about ten minutes before the class).

   One tap: records the mentor as joined — the same markInstructorJoined the
   Join button on Live Classes fires, which the no-show jobs read — and opens
   the class's room. An in-app class goes to its studio instead. A class with
   no room to open — in person, cancelled, ended, no link yet, or more than
   15 minutes early (the Live Classes Join button's own window) — says so
   rather than guessing.

   Signed out? The middleware sends them to /login with ?from= this page, and
   signing in brings them straight back here (lib/returnPath).
───────────────────────────────────────────────────────────── */
import { use, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Clock, MapPin, XCircle, Link2Off } from 'lucide-react'
import { useLiveClassById, markInstructorJoined, type LiveClass } from '@/lib/api/liveClasses'
import Spinner from '@/components/ui/Spinner'

const OPENS_BEFORE_MS = 15 * 60_000

type Verdict =
  | { kind: 'meet'; url: string }
  | { kind: 'studio' }
  | { kind: 'note'; icon: 'clock' | 'map' | 'x' | 'link'; title: string; body: string }

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function verdictFor(live: LiveClass, now: number): Verdict {
  if (live.status === 'cancelled') {
    return { kind: 'note', icon: 'x', title: 'This class was cancelled', body: 'There is nothing to start.' }
  }
  const start = new Date(live.scheduledStart).getTime()
  const end   = start + (live.durationMins || 60) * 60_000
  if (live.status === 'ended' || now >= end) {
    return { kind: 'note', icon: 'clock', title: 'This class has ended', body: `It ran from ${clock(start)} to ${clock(end)}.` }
  }
  if (live.isOnline === false) {
    const where = [live.location, live.room].filter(Boolean).join(' · ')
    return { kind: 'note', icon: 'map', title: 'This class is in person',
      body: where ? `It is at ${where}. There is no online room to open.` : 'There is no online room to open.' }
  }
  if (live.type === 'internal') return { kind: 'studio' }
  if (start - now > OPENS_BEFORE_MS && live.status !== 'live') {
    return { kind: 'note', icon: 'clock', title: 'Too early to start',
      body: `The room opens 15 minutes before the class, at ${clock(start - OPENS_BEFORE_MS)}. This link will work then.` }
  }
  if (!live.meetingUrl) {
    return { kind: 'note', icon: 'link', title: 'No meeting link yet', body: 'Ask an admin to add the link for this class.' }
  }
  return { kind: 'meet', url: live.meetingUrl }
}

const ICONS = { clock: Clock, map: MapPin, x: XCircle, link: Link2Off }

export default function JoinClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data: live, isLoading, isError } = useLiveClassById(id)
  const verdict = live ? verdictFor(live, Date.now()) : null
  /* Once. The class is re-polled every 10 s, and a second redirect mid-way
     through the first would be a second mark and a second navigation. */
  const sent = useRef(false)

  useEffect(() => {
    if (!verdict || sent.current) return
    if (verdict.kind === 'meet') {
      sent.current = true
      markInstructorJoined(id)          // records only when the caller IS the class's mentor
      window.location.replace(verdict.url)
    } else if (verdict.kind === 'studio') {
      sent.current = true
      router.replace(`/live-classes/${id}/studio`)
    }
  }, [verdict, id, router])

  if (isLoading || verdict?.kind === 'meet' || verdict?.kind === 'studio') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <Spinner size={22} />
        <p className="text-sm font-semibold text-white">Opening your class…</p>
        {live && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{live.title}</p>}
      </div>
    )
  }

  const note = verdict?.kind === 'note' ? verdict
    : { icon: 'x' as const, title: isError ? 'Class not found' : 'Something went wrong', body: 'Open Live Classes to find it.' }
  const Icon = ICONS[note.icon]

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl p-6 text-center"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Icon size={22} className="mx-auto" style={{ color: 'rgba(255,255,255,0.55)' }} />
        <h1 className="mt-3 text-base font-bold text-white">{note.title}</h1>
        {live && <p className="mt-1 text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{live.title}</p>}
        <p className="mt-3 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{note.body}</p>
        <Link href="/live-classes"
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white"
          style={{ background: 'rgba(255,255,255,0.08)' }}>
          <ArrowLeft size={14} />Live Classes
        </Link>
      </div>
    </div>
  )
}
