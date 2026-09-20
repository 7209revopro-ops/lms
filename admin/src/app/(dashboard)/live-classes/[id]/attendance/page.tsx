'use client'
import { zoneOf, foreignZoneTag } from '@/lib/timezone'

import { use } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle, XCircle, Users, ArrowLeft, Clock,
  BookOpen, GraduationCap, Download,
} from 'lucide-react'
import Link from 'next/link'
import {
  useAdminBookings, useUpdateAttendance, type BookingStatus,
} from '@/lib/api/liveClasses'
import { useLiveClassById } from '@/lib/api/liveClasses'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'

const STATUS_OPTIONS: { value: 'attended' | 'missed'; label: string; color: string; bg: string; border: string }[] = [
  { value: 'attended', label: 'Present', color: '#10B981', bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.35)' },
  { value: 'missed',   label: 'Absent',  color: '#EF4444', bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.35)'  },
]

function statusBadge(status: BookingStatus) {
  switch (status) {
    case 'attended':  return { label: 'Present',   color: '#10B981', bg: 'rgba(16,185,129,0.15)' }
    case 'missed':    return { label: 'Absent',    color: '#EF4444', bg: 'rgba(239,68,68,0.15)'  }
    case 'cancelled': return { label: 'Cancelled', color: '#9CA3AF', bg: 'rgba(156,163,175,0.12)' }
    default:          return { label: 'Booked',    color: '#818CF8', bg: 'rgba(99,102,241,0.15)' }
  }
}

function getModuleTitle(sectionId: unknown): string | null {
  if (!sectionId) return null
  if (typeof sectionId === 'object' && sectionId !== null && 'title' in sectionId) {
    return (sectionId as { title: string }).title
  }
  return null
}

function exportCSV(rows: any[]) {
  const header = ['Name', 'Email', 'Status', 'Booked At']
  const csvRows = rows.map((b: any) => [
    b.userId?.name ?? '',
    b.userId?.email ?? '',
    b.status ?? '',
    b.bookedAt ? new Date(b.bookedAt).toLocaleString() : '',
  ])
  const csvContent = [header, ...csvRows]
    .map(row => row.map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent)
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = 'attendance.csv'
  a.click()
}

/* ── Shared dark-panel style tokens ────────────────────── */
const card  = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }
const muted = 'rgba(255,255,255,0.45)'
const dim   = 'rgba(255,255,255,0.25)'

export default function AttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session, isLoading: sessionLoading } = useLiveClassById(id)
  const { data: bookings, isLoading: bookingsLoading, isError: bookingsError, refetch } =
    useAdminBookings({ liveClassId: id, per_page: 100 })
  const attendanceMutation = useUpdateAttendance()
  const toast = useToast()

  const isLoading = sessionLoading || bookingsLoading
  const rows = bookings?.docs ?? []

  /* WHAT THE SERVER HOLDS, AGAINST WHAT IT SENT. per_page is 100, so a cohort
     larger than that - the bulk DM import lands in exactly this shape - is
     silently cut, and every count below would then describe the first hundred
     while reading like the whole class. A register that is quietly missing
     students is worse than one that admits it. */
  const loaded    = rows.length
  const roster    = bookings?.meta?.total_count ?? loaded
  const truncated = roster > loaded

  const attended   = rows.filter((b: any) => b.status === 'attended').length
  const missed     = rows.filter((b: any) => b.status === 'missed').length
  const cancelled  = rows.filter((b: any) => b.status === 'cancelled').length
  const total      = rows.length

  const courseName     = (session as any)?.course?.title ?? null
  const moduleTitle    = session ? getModuleTitle((session as any).sectionId) : null
  const instructorName = (session as any)?.instructor?.name ?? null

  return (
    <div>
      {/* Back link */}
      <Link href="/live-classes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-60"
        style={{ color: muted }}>
        <ArrowLeft size={14} />Back to Live Classes
      </Link>

      {/* Header card */}
      <div className="mb-4 rounded-2xl p-5" style={card}>
        {session ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-lg font-bold text-white"
                style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                {session.title}
              </h1>
              <button
                onClick={() => exportCSV(rows)}
                className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.12)', color: muted }}>
                <Download size={11} />
                Export CSV
              </button>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: muted }}>
              <span className="flex items-center gap-1">
                <Clock size={11} />
                {new Date(session.scheduledStart).toLocaleString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                  /* This class's own academy clock — a lent instructor reads
                     the borrowing academy's schedule here, not their own. */
                  timeZone: zoneOf(session.organizationSlug),
                })}{foreignZoneTag(session.organizationSlug) && (
                  <span style={{ color: '#FBBF24' }}> {foreignZoneTag(session.organizationSlug)}</span>
                )}
              </span>
              <span style={{ color: dim }}>·</span>
              <span>{session.durationMins}m</span>

              {total > 0 && (
                <>
                  <span style={{ color: dim }}>·</span>
                  <span className="font-semibold" style={{ color: '#10B981' }}>
                    {attended}/{total} attended ({total > 0 ? Math.round((attended / total) * 100) : 0}%)
                  </span>
                </>
              )}
              {courseName && (
                <>
                  <span style={{ color: dim }}>·</span>
                  <span className="flex items-center gap-1">
                    <BookOpen size={11} />
                    {courseName}
                  </span>
                </>
              )}
              {moduleTitle && (
                <>
                  <span style={{ color: dim }}>·</span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#0057b8' }} />
                    {moduleTitle}
                  </span>
                </>
              )}
              {instructorName && (
                <>
                  <span style={{ color: dim }}>·</span>
                  <span className="flex items-center gap-1">
                    <GraduationCap size={11} />
                    {instructorName}
                  </span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="h-10 animate-pulse rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
        )}
      </div>

      {/* Stats strip */}
      {!isLoading && rows.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="flex items-center gap-3 rounded-xl px-4 py-2.5" style={card}>
            <span className="text-xs" style={{ color: muted }}>Total</span>
            <span className="text-sm font-bold text-white">{total}</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl px-4 py-2.5"
            style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)' }}>
            <span className="text-xs" style={{ color: '#6EE7B7' }}>Attended</span>
            <span className="text-sm font-bold" style={{ color: '#10B981' }}>{attended}</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl px-4 py-2.5"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="text-xs" style={{ color: '#FCA5A5' }}>Missed</span>
            <span className="text-sm font-bold" style={{ color: '#EF4444' }}>{missed}</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl px-4 py-2.5" style={card}>
            <span className="text-xs" style={{ color: muted }}>Cancelled</span>
            <span className="text-sm font-bold" style={{ color: dim }}>{cancelled}</span>
          </div>
        </div>
      )}

      {/* Attendance sheet */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center gap-2 text-sm" style={{ color: dim }}>
          <Spinner size={16} />Loading attendance…
        </div>
      ) : bookingsError ? (
        /* "No bookings yet" on a FAILED fetch told an instructor the room was
           empty. On a register that is not a blank state, it is a wrong
           answer - and the register is the one thing this page is for. */
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <Users size={22} style={{ color: '#EF4444' }} />
          </div>
          <p className="text-sm font-semibold text-white">Could not load the register</p>
          <p className="text-xs" style={{ color: dim }}>Nobody has been marked absent - the list just did not arrive.</p>
          <button type="button" onClick={() => void refetch()}
            className="mt-1 flex min-h-[44px] items-center rounded-xl px-4 text-xs font-semibold sm:min-h-0 sm:py-2"
            style={{ background: 'rgba(0,87,184,0.14)', border: '1px solid rgba(0,87,184,0.35)', color: '#60A5FA' }}>
            Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.18)' }}>
            <Users size={22} style={{ color: '#0057b8' }} />
          </div>
          <p className="text-sm font-semibold text-white">No bookings yet</p>
          <p className="text-xs" style={{ color: dim }}>Students haven't booked this session</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl" style={card}>
          {truncated && (
            <p className="px-5 py-2.5 text-xs font-semibold"
              style={{ color: '#FBBF24', background: 'rgba(250,204,21,0.06)', borderBottom: '1px solid rgba(250,204,21,0.15)' }}>
              Showing {loaded} of {roster} students. The counts above describe these {loaded} only.
            </p>
          )}
          {/* THE ONE THING THIS PAGE IS FOR MUST BE REACHABLE.

              At 375px the third column - Present / Absent - sat off the edge
              of a card that did not scroll, so an instructor taking a register
              from the back of a room could not mark anybody. Every other table
              in the app already wraps in a scroller; this one did not.
              min-w keeps the three columns from crushing into each other
              before the scroller takes over. */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wide" style={{ color: dim }}>Student</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wide" style={{ color: dim }}>Status</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wide" style={{ color: dim }}>Mark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((booking: any, i: number) => {
                const badge      = statusBadge(booking.status as BookingStatus)
                const isPending  = attendanceMutation.isPending && attendanceMutation.variables?.id === booking.id
                const bookingKey = booking.id || booking._id
                const nameInitial = booking.userId?.name ? booking.userId.name.charAt(0).toUpperCase() : '?'

                return (
                  <motion.tr key={bookingKey}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="transition-colors"
                    style={{
                      borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

                    {/* Student */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)' }}>
                          {nameInitial}
                        </div>
                        <div>
                          <p className="font-semibold text-white">{booking.userId?.name ?? '—'}</p>
                          <p className="text-xs" style={{ color: dim }}>{booking.userId?.email ?? ''}</p>
                        </div>
                      </div>
                    </td>

                    {/* Status badge */}
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
                        style={{ background: badge.bg, color: badge.color }}>
                        {booking.status === 'attended' ? <CheckCircle size={11} />
                          : booking.status === 'missed' ? <XCircle size={11} />
                          : null}
                        {badge.label}
                      </span>
                    </td>

                    {/* Mark buttons */}
                    <td className="px-5 py-3">
                      {booking.status !== 'cancelled' && (
                        <div className="flex items-center gap-2">
                          {STATUS_OPTIONS.map(opt => {
                            const isActive = booking.status === opt.value
                            return (
                              <button key={opt.value}
                                /* Marking was fire-and-forget: a 403, a 401 or a
                                   dropped connection looked exactly like a save,
                                   so an instructor walked away believing the
                                   register was taken. */
                                onClick={() => attendanceMutation.mutate(
                                  { id: booking.id, status: opt.value },
                                  { onError: () => toast.error('Could not mark attendance', 'Nothing was saved - try again.') },
                                )}
                                disabled={isPending || isActive}
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all disabled:opacity-40"
                                style={{
                                  background: isActive ? opt.bg : 'rgba(255,255,255,0.05)',
                                  color:      isActive ? opt.color : muted,
                                  border:     `1px solid ${isActive ? opt.border : 'rgba(255,255,255,0.08)'}`,
                                }}>
                                {isPending
                                  ? <Spinner size={10} />
                                  : opt.value === 'attended' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
