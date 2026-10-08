'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3, Users, CheckCircle, XCircle, Download, Calendar,
  TrendingUp, UserCheck,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useCurrentUser } from '@/lib/api/user'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'
import { CsTag, csName, csTeam } from '@/components/ui/CsTag'
import type { TetraCs } from '@/lib/api/tetraCs'

/* ── Types ─────────────────────────────────────────────── */
interface AttendanceRow {
  user:     { id: string; name: string; email: string , _id?:string; tetraCs?: TetraCs | null }
  total:    number
  attended: number
  missed:   number
  booked:   number
}

interface MentorScheduleRow {
  mentor:         { id: string; name: string; email: string , _id?:string}
  assigned:       number
  conducted:      number
  cancelled:      number
  completionPct:  number
}

/* ── Hooks ─────────────────────────────────────────────── */
function useAttendanceReport(from: string, to: string) {
  return useQuery({
    queryKey: ['admin', 'reports', 'attendance', { from, to }],
    queryFn:  () => {
      const params: Record<string, string> = {}
      if (from) params.from = from
      if (to)   params.to   = to
      return apiGet<AttendanceRow[]>('/admin/reports/attendance', params as any)
    },
    staleTime: 60_000,
  })
}

function useMentorScheduleReport(mentorId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['admin', 'reports', 'mentor-schedule', { mentorId, from, to }],
    queryFn:  () => {
      const params: Record<string, string> = {}
      if (mentorId) params.mentorId = mentorId
      if (from) params.from = from
      if (to)   params.to   = to
      return apiGet<MentorScheduleRow[]>('/admin/reports/mentor-schedule', params as any)
    },
    staleTime: 60_000,
  })
}


/* ── CSV export ────────────────────────────────────────── */
function downloadCsv(rows: AttendanceRow[]) {
  const header = 'Name,Email,CS,CS Team,Total,Attended,Missed,Pending,Attendance %'
  const quote  = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines  = rows.map(r => {
    const pct = r.total > 0 ? Math.round((r.attended / r.total) * 100) : 0
    return `"${r.user.name}","${r.user.email}",${quote(csName(r.user.tetraCs))},${quote(csTeam(r.user.tetraCs))},${r.total},${r.attended},${r.missed},${r.booked},${pct}%`
  })
  const csv  = [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'attendance-report.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function downloadMentorCsv(rows: MentorScheduleRow[]) {
  const header = 'Mentor,Email,Assigned,Conducted,Cancelled,Completion %'
  const lines  = rows.map(r =>
    `"${r.mentor.name}","${r.mentor.email}",${r.assigned},${r.conducted},${r.cancelled},${r.completionPct}%`
  )
  const csv  = [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'mentor-schedule-report.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/* ── Rate ring ─────────────────────────────────────────── */
function RateRing({ pct, size = 52 }: { pct: number; size?: number }) {
  const r   = (size / 2) - 5
  const circ = 2 * Math.PI * r
  const fill = (pct / 100) * circ
  const color = pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle key="bg" cx={size/2} cy={size/2} r={r} fill="none" stroke="#F3F4F6" strokeWidth={5} />
      <circle key="fill" cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text key="label" x={size/2} y={size/2 + 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill={color}>
        {`${pct}%`}
      </text>
    </svg>
  )
}

/* ── Page ──────────────────────────────────────────────── */
export default function ReportsPage() {
  const { data: me } = useCurrentUser()

  const [mentorId, setMentorId] = useState('')
  const [from,     setFrom]     = useState('')
  const [to,       setTo]       = useState('')

  const attendance     = useAttendanceReport(from, to)
  const mentorSchedule = useMentorScheduleReport(mentorId, from, to)

  const attendanceRows     = Array.isArray(attendance.data)     ? attendance.data     : []
  const mentorScheduleRows = Array.isArray(mentorSchedule.data) ? mentorSchedule.data : []

  const inputBase  = 'rounded-xl border border-[#E4E7ED] bg-white px-3 py-2 text-sm outline-none focus:border-[#0057b8] focus:ring-2 focus:ring-blue-100'

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <PageHeader
          title="Reports"
          subtitle="Attendance and performance analytics"
          badge={{ label: 'Analytics', color: '#0057b8' }}
        />
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className={inputBase} style={{ color: '#0D0F1A' }} title="From date" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className={inputBase} style={{ color: '#0D0F1A' }} title="To date" />
        {(from || to || mentorId) && (
          <button onClick={() => { setFrom(''); setTo(''); setMentorId('') }}
            className="rounded-xl border border-[#E4E7ED] bg-white px-3 py-2 text-sm text-[#6B7280] hover:bg-gray-50">
            Clear filters
          </button>
        )}
      </div>

      {/* ── Mentor Schedule ─────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <UserCheck size={16} style={{ color: '#0057b8' }} />
            <h2 className="text-base font-bold" style={{ color: '#0D0F1A', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Mentor Schedule
            </h2>
            {mentorScheduleRows.length > 0 && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}>
                {mentorScheduleRows.length} mentors
              </span>
            )}
          </div>
          {mentorScheduleRows.length > 0 && (
            <button onClick={() => downloadMentorCsv(mentorScheduleRows)}
              className="flex items-center gap-1.5 rounded-xl border border-[#E4E7ED] bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-gray-50"
              style={{ color: '#374151' }}>
              <Download size={12} /><span>CSV</span>
            </button>
          )}
        </div>

        {mentorSchedule.isLoading ? (
          <div className="flex h-24 items-center justify-center gap-2 text-sm" style={{ color: '#9CA3AF' }}>
            <Spinner size={15} /><span>Loading…</span>
          </div>
        ) : mentorScheduleRows.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: '#9CA3AF' }}>No mentor schedule data yet</p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white" style={{ border: '1px solid #E4E7ED' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                  {['Mentor', 'Assigned', 'Conducted', 'Cancelled', 'Completion'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide"
                      style={{ color: '#9CA3AF' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mentorScheduleRows.map((row, i) => (
                  <motion.tr key={row.mentor.id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="transition-colors hover:bg-gray-50"
                    style={{ borderBottom: i < mentorScheduleRows.length - 1 ? '1px solid #F9FAFB' : 'none' }}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-sm" style={{ color: '#0D0F1A' }}>{row.mentor.name}</p>
                      <p className="text-xs" style={{ color: '#9CA3AF' }}>{row.mentor.email}</p>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{row.assigned}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#10B981' }}>
                        <CheckCircle size={11} /><span>{row.conducted}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#EF4444' }}>
                        <XCircle size={11} /><span>{row.cancelled}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: '#F3F4F6' }}>
                          <div className="h-full rounded-full"
                            style={{ width: `${row.completionPct}%`, background: row.completionPct >= 80 ? '#10B981' : row.completionPct >= 50 ? '#F59E0B' : '#EF4444' }} />
                        </div>
                        <span className="text-xs font-bold"
                          style={{ color: row.completionPct >= 80 ? '#10B981' : row.completionPct >= 50 ? '#F59E0B' : '#EF4444' }}>
                          {`${row.completionPct}%`}
                        </span>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>


      {/* ── Attendance Report ──────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} style={{ color: '#0057b8' }} />
            <h2 className="text-base font-bold" style={{ color: '#0D0F1A', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Attendance
            </h2>
            {attendanceRows.length > 0 && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}>
                {attendanceRows.length} students
              </span>
            )}
          </div>
          {attendanceRows.length > 0 && (
            <button onClick={() => downloadCsv(attendanceRows)}
              className="flex items-center gap-1.5 rounded-xl border border-[#E4E7ED] bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-gray-50"
              style={{ color: '#374151' }}>
              <Download size={12} /><span>CSV</span>
            </button>
          )}
        </div>

        {attendance.isLoading ? (
          <div className="flex h-24 items-center justify-center gap-2 text-sm" style={{ color: '#9CA3AF' }}>
            <Spinner size={15} /><span>Loading…</span>
          </div>
        ) : attendanceRows.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: '#9CA3AF' }}>No attendance data for the selected filters</p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white" style={{ border: '1px solid #E4E7ED' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                  {['Student', 'Attended', 'Missed', 'Pending', 'Rate'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide"
                      style={{ color: '#9CA3AF' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendanceRows.map((row, i) => {
                  const pct   = row.total > 0 ? Math.round((row.attended / row.total) * 100) : 0
                  const color = pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444'
                  return (
                    <motion.tr key={(row.user as any).id ?? (row.user as any)._id ?? i}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className="transition-colors hover:bg-gray-50"
                      style={{ borderBottom: i < attendanceRows.length - 1 ? '1px solid #F9FAFB' : 'none' }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-sm" style={{ color: '#0D0F1A' }}>{row.user.name}</p>
                        <p className="text-xs" style={{ color: '#9CA3AF' }}>{row.user.email}</p>
                        <CsTag cs={row.user.tetraCs} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#10B981' }}>
                          <CheckCircle size={11} /><span>{row.attended}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#EF4444' }}>
                          <XCircle size={11} /><span>{row.missed}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#9CA3AF' }}>{row.booked}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: '#F3F4F6' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <span className="text-xs font-bold" style={{ color }}>{`${pct}%`}</span>
                        </div>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
