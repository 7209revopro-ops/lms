'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Video, Calendar, Clock, CheckCircle, XCircle,
  X as XIcon, AlertCircle, ExternalLink, Tv2, BookOpen, FileText,
} from 'lucide-react'
import Link from 'next/link'
import { useMyBookings, useCancelBooking, type BookingStatus, type MyBooking } from '@/lib/api/bookings'
import { useAllLiveClasses, type LiveClass } from '@/lib/api/liveClasses'
import { useJoinClock } from '@/hooks/useJoinClock'
import JoinMeetButton from '@/components/live-classes/JoinMeetButton'
import Spinner from '@/components/ui/Spinner'

/* ── Helpers ─────────────────────────────────────────── */
function fmtDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const tom   = new Date(Date.now() + 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tom.toDateString())   return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function statusInfo(status: BookingStatus) {
  switch (status) {
    case 'attended':  return { label: 'Attended',  color: 'var(--color-success)', bg: 'rgba(16,185,129,0.08)',  icon: CheckCircle }
    case 'missed':    return { label: 'Missed',    color: 'var(--color-danger)', bg: 'rgba(239,68,68,0.08)',   icon: XCircle }
    case 'cancelled': return { label: 'Cancelled', color: 'var(--color-text-muted)', bg: 'rgba(156,163,175,0.08)', icon: XIcon }
    default:          return { label: 'Booked',    color: '#6366F1', bg: 'rgba(99,102,241,0.08)',  icon: CheckCircle }
  }
}

/* ── Booking card ─────────────────────────────────────── */
/* `live` is the matching /live-classes row: a booking row carries neither the
   Meet link nor the join window, so the button reads the SERVER's window from
   there. Absent while that list loads or if the class is gone — no button. */
function BookingCard({ booking, live, now }: { booking: MyBooking; live?: LiveClass; now: number }) {
  const cancelMutation = useCancelBooking()
  const [confirming, setConfirming] = useState(false)

  const session   = booking.liveClassId
  const isPast    = new Date(session.scheduledStart) < new Date() || session.status === 'ended' || session.status === 'cancelled'
  const isLiveNow = session.status === 'live'
  /* An attended seat is still a seat. The server releases the link to
     'attended' as well as 'booked' — an admin taking the register mid-class
     must not make the button vanish for someone whose call just dropped —
     so this page must not be stricter than the gate behind it. */
  const isBooked  = booking.status === 'booked' || booking.status === 'attended'
  const { label, color, bg, icon: StatusIcon } = statusInfo(booking.status)
  const isExternal = session.type === 'external'

  const handleCancel = async () => {
    if (!confirming) { setConfirming(true); return }
    await cancelMutation.mutateAsync(booking.id)
    setConfirming(false)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="rounded-2xl bg-[var(--color-bg-surface)] p-4 transition-shadow hover:shadow-sm"
      style={{ border: isLiveNow ? '1px solid rgba(239,68,68,0.30)' : '1px solid var(--color-border)' }}>

      {/* Top row */}
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: isLiveNow ? 'rgba(239,68,68,0.10)' : isExternal ? 'rgba(99,102,241,0.08)' : 'rgba(0,87,184,0.08)',
            border:     isLiveNow ? '1px solid rgba(239,68,68,0.20)' : isExternal ? '1px solid rgba(99,102,241,0.15)' : '1px solid rgba(0,87,184,0.15)',
          }}>
          {isLiveNow
            ? <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
                <Video size={16} style={{ color: 'var(--color-danger)' }} />
              </motion.div>
            : isExternal
            ? <ExternalLink size={16} style={{ color: '#6366F1' }} />
            : <Tv2 size={16} style={{ color: 'var(--color-primary)' }} />}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            {/* Live badge */}
            {isLiveNow && (
              <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                style={{ background: 'var(--color-danger)' }}>
                <span className="h-1 w-1 rounded-full bg-[var(--color-bg-surface)]" />LIVE
              </motion.span>
            )}
            {/* Attendance status */}
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: bg, color }}>
              <StatusIcon size={9} />{label}
            </span>
          </div>
          <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{session.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <span className="flex items-center gap-1"><Calendar size={10} />{fmtDate(session.scheduledStart)}</span>
            <span>·</span>
            <span className="flex items-center gap-1"><Clock size={10} />{fmtTime(session.scheduledStart)}</span>
            <span>·</span>
            <span>{fmtDuration(session.durationMins)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          {/* Join — NOT gated on isPast: the Meet window is start → start+20
              min, so the button must show precisely once the start has passed.
              Before it, "Join opens at"; after, "Join link closed". */}
          {isBooked && isExternal && live && (
            <JoinMeetButton
              sessionId={session.id} now={now} size="sm"
              accent={isLiveNow ? '#EF4444' : '#0057b8'}
              isBooked={live.isBooked ?? true}
              joinOpensAt={live.joinOpensAt} joinClosesAt={live.joinClosesAt}
              type={live.type} isOnline={live.isOnline} status={live.status} />
          )}
          {!isPast && isBooked && !isExternal && session.muxPlaybackId && (
            <a href={`/live-classes/${session.id}/watch`}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white"
              style={{ background: isLiveNow ? '#EF4444' : '#0057b8' }}>
              <Video size={11} />Watch
            </a>
          )}
          {/* Homework link for internal sessions */}
          {!isExternal && (
            <Link href={`/live-classes/${session.id}/watch`}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{ background: 'rgba(0,87,184,0.08)', color: 'var(--color-primary)', border: '1px solid rgba(0,87,184,0.18)' }}>
              <FileText size={11} />Homework
            </Link>
          )}
          {/* Cancel button for upcoming BOOKED seats only — not attended ones.
              isBooked above deliberately includes 'attended' so the Join
              button survives the register being taken; cancelling is a
              different question, and the server refuses it for an attended
              seat (CANNOT_CANCEL), so the button must not be offered. */}
          {!isPast && booking.status === 'booked' && (
            confirming ? (
              <div className="flex items-center gap-1.5">
                <button onClick={() => setConfirming(false)} className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  No
                </button>
                <button onClick={handleCancel} disabled={cancelMutation.isPending}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60"
                  style={{ background: 'var(--color-danger)' }}>
                  {cancelMutation.isPending ? <Spinner size={9} /> : null}
                  Cancel booking
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirming(true)}
                className="text-[10px] font-medium transition-colors hover:text-red-500"
                style={{ color: 'var(--color-text-muted)' }}>
                Cancel
              </button>
            )
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* ── Page ──────────────────────────────────────────────── */
const TABS: { key: BookingStatus | 'upcoming'; label: string }[] = [
  { key: 'upcoming',  label: 'Upcoming' },
  { key: 'attended',  label: 'Attended' },
  { key: 'missed',    label: 'Missed' },
  { key: 'cancelled', label: 'Cancelled' },
]

export default function MyBookingsPage() {
  const [tab, setTab] = useState<BookingStatus | 'upcoming'>('upcoming')

  const statusParam = tab === 'upcoming' ? 'booked' : tab
  const { data, isLoading } = useMyBookings({ status: statusParam as BookingStatus, per_page: 50 })
  /* The join window lives on the live-class row, not the booking row. */
  const { data: classes }   = useAllLiveClasses()
  const liveById = useMemo(() => {
    const m = new Map<string, LiveClass>()
    for (const c of classes ?? []) m.set(c.id, c)
    return m
  }, [classes])
  const now = useJoinClock(classes)

  const bookings = data?.docs ?? []

  /* For upcoming, keep a session until it ENDS, not until it starts: a
     booked class that began five minutes ago is exactly the one whose Join
     button must be on this screen. `status` here is the stored value, so
     the end is computed from the schedule rather than trusted from it. */
  const filtered = tab === 'upcoming'
    ? bookings.filter(b => {
        const lc  = b.liveClassId
        const end = new Date(lc.scheduledStart).getTime() + (lc.durationMins || 60) * 60_000
        return end >= now || lc.status === 'live'
      })
    : bookings

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          My Classes
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Your session bookings and attendance history
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 rounded-2xl p-1" style={{ background: 'var(--color-bg-subtle)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all"
            style={{
              background: tab === t.key ? 'var(--color-bg-surface)' : 'transparent',
              color:      tab === t.key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              boxShadow:  tab === t.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <Spinner size={16} />Loading…
        </div>
      ) : filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.15)' }}>
            <Video size={22} style={{ color: 'var(--color-primary)' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            No {tab === 'upcoming' ? 'upcoming classes' : `${tab} sessions`}
          </p>
          <p className="text-xs text-center max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
            {tab === 'upcoming'
              ? 'Visit the Live Classes page to book available sessions.'
              : 'Your history will appear here once you attend or miss a session.'}
          </p>
        </motion.div>
      ) : (
        <motion.div layout className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {filtered.map(booking => (
              <BookingCard key={booking.id} booking={booking} live={liveById.get(booking.liveClassId.id)} now={now} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}
