'use client'

import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Mail, CheckCircle2, XCircle, BookOpen, Calendar, Clock,
  ShoppingBag, Video, GraduationCap, Receipt, Gift,
} from 'lucide-react'
import type { AdminUser } from '@/lib/api/users'
import { useStudentEnrollments, useStudentOrders } from '@/lib/api/users'
import { useAdminBookings } from '@/lib/api/liveClasses'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'

const BOOKING_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  booked:    { bg: 'rgba(16,185,129,0.12)',  color: '#34D399', label: 'Upcoming' },
  attended:  { bg: 'rgba(99,102,241,0.15)',  color: '#818CF8', label: 'Attended' },
  missed:    { bg: 'rgba(245,158,11,0.14)',  color: '#FCD34D', label: 'Missed' },
  cancelled: { bg: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', label: 'Cancelled' },
}

// Enrollment's populated courseId only reliably carries `_id` (the `id`
// virtual isn't applied to populated refs under `.lean({virtuals:true})`),
// while Order's carries `id` (full Mongoose doc serialized via toJSON).
// Normalize both shapes to a single string key for matching.
function courseKey(courseId?: { _id?: string; id?: string }): string {
  return String(courseId?.id ?? courseId?._id ?? '')
}

/* Orders and finance summaries hold the smallest unit (cents / fils). */
function fmtMoney(minor: number, currency: string) {
  const amount = (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${currency.toUpperCase()} ${amount}`
}

function fmtDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(d?: string) {
  if (!d) return '—'
  const date = new Date(d)
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function StatTile({ icon: Icon, label, value, color, bg }: {
  icon: React.ComponentType<{ size?: number }>
  label: string
  value: number
  color: string
  bg: string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-center"
      style={{ background: bg, border: `1px solid ${color}30` }}>
      <Icon size={15} />
      <p className="text-lg font-bold text-white leading-none">{value}</p>
      <p className="text-[10px] font-medium leading-none" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
    </div>
  )
}

interface Props {
  user:    AdminUser
  onClose: () => void
}

export function StudentHistoryModal({ user, onClose }: Props) {
  const { data: enrollments, isLoading: enrollmentsLoading } = useStudentEnrollments(user.id)
  const { data: orders,      isLoading: ordersLoading }      = useStudentOrders(user.id)
  const { data: bookingsRes, isLoading: bookingsLoading }     = useAdminBookings({ userId: user.id, per_page: 200 })

  const bookings   = bookingsRes?.docs ?? []
  const totalCount = bookingsRes?.meta.total_count ?? 0
  const bookedCount   = bookings.filter(b => b.status === 'booked').length
  const attendedCount = bookings.filter(b => b.status === 'attended').length
  const missedCount   = bookings.filter(b => b.status === 'missed').length

  /* Merge enrollments + orders by courseId so a course only shows once,
     combining progress/module-access info with purchase info when both exist. */
  const courseRows = (enrollments ?? []).map(e => ({
    enrollment: e,
    order: (orders ?? []).find(o => courseKey(o.courseId) === courseKey(e.courseId)),
  }))
  const ordersWithoutEnrollment = (orders ?? []).filter(
    o => !(enrollments ?? []).some(e => courseKey(e.courseId) === courseKey(o.courseId)),
  )

  const loading = enrollmentsLoading || ordersLoading

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-end"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          onClick={e => e.stopPropagation()}
          className="flex h-full w-full max-w-md flex-col shadow-2xl overflow-y-auto"
          style={{ background: '#161829', borderLeft: '1px solid rgba(255,255,255,0.09)' }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 p-6"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-4">
              <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl"
                style={{ background: 'rgba(0,87,184,0.15)', border: '2px solid rgba(0,87,184,0.25)' }}>
                <AvatarImg src={user.avatarUrl}
                  className="h-full w-full object-cover"
                  fallback={<span className="text-2xl font-bold" style={{ color: '#0057b8' }}>{user.name[0]?.toUpperCase()}</span>} />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white truncate" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                  {user.name}
                </h2>
                <p className="mt-0.5 flex items-center gap-1 text-xs truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <Mail size={11} />{user.email}
                </p>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                    style={user.isActive
                      ? { background: 'rgba(74,222,128,0.12)', color: '#4ADE80' }
                      : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
                    {user.isActive ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.4)' }}>
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 space-y-6 p-6">
            {/* Stat tiles */}
            <div className="grid grid-cols-4 gap-2">
              <StatTile icon={ShoppingBag} label="Purchased" value={(orders ?? []).filter(o => o.status === 'paid').length}
                color="#60A5FA" bg="rgba(96,165,250,0.10)" />
              <StatTile icon={Video} label="Booked" value={bookedCount}
                color="#34D399" bg="rgba(16,185,129,0.08)" />
              <StatTile icon={CheckCircle2} label="Attended" value={attendedCount}
                color="#818CF8" bg="rgba(99,102,241,0.10)" />
              <StatTile icon={XCircle} label="Missed" value={missedCount}
                color="#FCD34D" bg="rgba(245,158,11,0.08)" />
            </div>

            {/* Courses (purchased + enrolled) */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
                <BookOpen size={11} className="inline mr-1.5" />Courses
              </p>
              {loading ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  <Spinner size={11} />Loading…
                </div>
              ) : courseRows.length === 0 && ordersWithoutEnrollment.length === 0 ? (
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>No course purchases or enrollments yet.</p>
              ) : (
                <div className="space-y-2">
                  {courseRows.map(({ enrollment: e, order: o }) => (
                    <div key={e._id ?? e.id} className="rounded-xl p-2.5"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-12 flex-shrink-0 overflow-hidden rounded-lg"
                          style={{ background: 'rgba(255,255,255,0.08)' }}>
                          {e.courseId?.thumbnailUrl && (
                            <img src={e.courseId.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-white">{e.courseId?.title ?? '—'}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]"
                            style={{ color: 'rgba(255,255,255,0.4)' }}>
                            {typeof e.progressPercent === 'number' && <span>{e.progressPercent}% complete</span>}
                            {e.blockedLessons.length > 0 && (
                              <span style={{ color: '#F87171' }}>
                                {e.blockedLessons.length} module{e.blockedLessons.length !== 1 ? 's' : ''} blocked
                              </span>
                            )}
                            {o && (
                              <span>
                                {fmtMoney(o.amount, o.currency)} · {o.gateway} · {fmtDate(o.createdAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* The enrolment's money as finance approved it — shown
                          for information; finance is the record of payments. */}
                      {e.feeSummary && (
                        <div className="mt-2 rounded-lg px-2.5 py-2 text-[10px]"
                          style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', color: 'rgba(255,255,255,0.55)' }}>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>Fee <b className="text-white">{fmtMoney(e.feeSummary.feeMinor, e.feeSummary.currency)}</b></span>
                            <span>Paid <b style={{ color: '#4ADE80' }}>{fmtMoney(e.feeSummary.paidMinor, e.feeSummary.currency)}</b></span>
                            <span>Balance <b style={{ color: e.feeSummary.balanceMinor > 0 ? '#FCD34D' : '#4ADE80' }}>{fmtMoney(e.feeSummary.balanceMinor, e.feeSummary.currency)}</b></span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            {e.feeSummary.bonus && (
                              <span className="inline-flex items-center gap-1">
                                <Gift size={10} />
                                Bonus {e.feeSummary.bonus.given ? <b className="text-white">{fmtMoney(e.feeSummary.bonus.amountMinor, e.feeSummary.currency)}</b> : 'none'}
                              </span>
                            )}
                            {e.feeSummary.receipt?.url && (
                              <a href={e.feeSummary.receipt.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 hover:underline" style={{ color: '#60A5FA' }}>
                                <Receipt size={10} />Receipt
                              </a>
                            )}
                            <span>From finance{e.feeSummary.invoiceNumber ? ` · ${e.feeSummary.invoiceNumber}` : ''}, at approval</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {ordersWithoutEnrollment.map(o => (
                    <div key={o.id} className="rounded-xl p-2.5"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-12 flex-shrink-0 overflow-hidden rounded-lg"
                          style={{ background: 'rgba(255,255,255,0.08)' }}>
                          {o.courseId?.thumbnailUrl && (
                            <img src={o.courseId.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-white">{o.courseId?.title ?? '—'}</p>
                          <div className="mt-0.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                            {fmtMoney(o.amount, o.currency)} · {o.gateway} · {fmtDate(o.createdAt)}
                            {' · '}
                            <span style={{ color: o.status === 'paid' ? '#4ADE80' : 'rgba(255,255,255,0.4)' }}>{o.status}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Class booking history */}
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
                <Video size={11} className="inline mr-1.5" />Class Booking History
              </p>
              {bookingsLoading ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  <Spinner size={11} />Loading…
                </div>
              ) : bookings.length === 0 ? (
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>No classes booked yet.</p>
              ) : (
                <div className="space-y-2">
                  {bookings.map(b => {
                    const st = BOOKING_STATUS_STYLE[b.status] ?? BOOKING_STATUS_STYLE['booked']
                    return (
                      <div key={b.id} className="rounded-xl p-2.5"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-white">{b.liveClassId?.title ?? '—'}</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]"
                              style={{ color: 'rgba(255,255,255,0.4)' }}>
                              <span className="inline-flex items-center gap-1">
                                <Calendar size={9} />{fmtDateTime(b.liveClassId?.scheduledStart)}
                              </span>
                              {b.liveClassId?.durationMins != null && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={9} />{b.liveClassId.durationMins}m
                                </span>
                              )}
                              {b.liveClassId?.courseId?.title && (
                                <span className="inline-flex items-center gap-1">
                                  <BookOpen size={9} />{b.liveClassId.courseId.title}
                                </span>
                              )}
                              {b.liveClassId?.instructorId?.name && (
                                <span className="inline-flex items-center gap-1">
                                  <GraduationCap size={9} />{b.liveClassId.instructorId.name}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="flex-shrink-0 inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: st.bg, color: st.color }}>
                            {st.label}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  {totalCount > bookings.length && (
                    <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      +{totalCount - bookings.length} earlier bookings not shown.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
