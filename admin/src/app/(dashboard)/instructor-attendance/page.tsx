'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  UserX, ChevronLeft, ChevronRight, AlertCircle, Clock, CheckCircle2,
} from 'lucide-react'
import { useNoShowAlerts, type NoShowAlert } from '@/lib/api/instructorAttendance'
import Spinner from '@/components/ui/Spinner'

/* ─── Helpers ──────────────────────────────────────────── */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function minutesLate(scheduledStart: string, joinedAt: string): number {
  return Math.max(0, Math.round((new Date(joinedAt).getTime() - new Date(scheduledStart).getTime()) / 60_000))
}

/* ─── Row ──────────────────────────────────────────────── */
function AlertRow({ alert, index }: { alert: NoShowAlert; index: number }) {
  const joinedLate = !!alert.instructorJoinedAt

  return (
    <motion.tr
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02 }}
      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      className="transition-colors hover:bg-white/[0.025]">

      <td className="px-4 py-3 tabular-nums text-[11px] whitespace-nowrap"
        style={{ color: 'rgba(255,255,255,0.4)' }}>
        {fmtDate(alert.scheduledStart)}
      </td>

      <td className="px-4 py-3">
        <p className="text-xs font-medium text-white truncate max-w-[220px]">{alert.title}</p>
        {alert.course && (
          <p className="text-[10px] truncate max-w-[220px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{alert.course.title}</p>
        )}
      </td>

      <td className="px-4 py-3">
        {alert.instructor ? (
          <div>
            <p className="text-xs font-medium text-white truncate max-w-[180px]">{alert.instructor.name}</p>
            <p className="text-[10px] truncate max-w-[180px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{alert.instructor.email}</p>
          </div>
        ) : (
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>—</span>
        )}
      </td>

      <td className="px-4 py-3">
        <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold capitalize"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
          {alert.type}
        </span>
      </td>

      <td className="px-4 py-3">
        {joinedLate ? (
          <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: 'rgba(250,204,21,0.15)', color: '#FACC15' }}>
            <Clock size={10} />
            Joined {minutesLate(alert.scheduledStart, alert.instructorJoinedAt!)} min late
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: 'rgba(248,113,113,0.15)', color: '#F87171' }}>
            <AlertCircle size={10} />
            Never joined
          </span>
        )}
      </td>
    </motion.tr>
  )
}

/* ─── Page ─────────────────────────────────────────────── */
export default function InstructorAttendancePage() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError } = useNoShowAlerts({ page })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)' }}>
            <UserX size={16} style={{ color: '#F87171' }} />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Instructor Attendance
          </h1>
        </div>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Classes where the mentor had not joined 5 minutes after the scheduled start. Everyone alerted at the time — the mentor, your academy's admins, and the program's sub-admins — is listed here too.
        </p>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Scheduled', 'Class', 'Instructor', 'Type', 'Outcome'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold"
                    style={{ color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="py-16 text-center">
                  <Spinner size={18} variant="muted" />
                </td></tr>
              ) : isError ? (
                <tr><td colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle size={22} style={{ color: '#F87171' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Failed to load instructor attendance alerts</p>
                  </div>
                </td></tr>
              ) : !data?.docs.length ? (
                <tr><td colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 size={22} style={{ color: 'rgba(74,222,128,0.6)' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No no-show alerts — every mentor has been on time.</p>
                  </div>
                </td></tr>
              ) : data.docs.map((alert, i) => (
                <AlertRow key={alert.id} alert={alert} index={i} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data?.meta && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {data.meta.total_count.toLocaleString()} alerts · page {data.meta.page} of {data.meta.total_pages}
            </p>
            <div className="flex gap-1">
              <button disabled={!data.meta.has_prev} onClick={() => setPage(p => p - 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 transition-colors hover:bg-white/[0.05]">
                <ChevronLeft size={14} style={{ color: 'white' }} />
              </button>
              <button disabled={!data.meta.has_next} onClick={() => setPage(p => p + 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 transition-colors hover:bg-white/[0.05]">
                <ChevronRight size={14} style={{ color: 'white' }} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
