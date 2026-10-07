'use client'

/* ─────────────────────────────────────────────────────────────
   Class Verification — after every class its mentor checks the attendance
   and reviews the class (reminders.job.ts asks once attendance is decided,
   reminds at +2 h, and the next morning the class turns Overdue).

   A mentor sees their own classes; admins see every mentor's, filterable by
   mentor and date. One row per class → its page (/class-verification/<id>).
───────────────────────────────────────────────────────────── */
import { useState } from 'react'
import Link from 'next/link'
import { ClipboardCheck, Clock, AlertTriangle, CheckCircle2, ChevronRight, Star } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { useProgramInstructors } from '@/lib/api/users'
import { useVerifyList, type VerifyStatus } from '@/lib/api/classVerification'
import Spinner from '@/components/ui/Spinner'

const TABS: { key: VerifyStatus; label: string; icon: typeof Clock; color: string }[] = [
  { key: 'pending',  label: 'Pending',  icon: Clock,          color: '#FBBF24' },
  { key: 'overdue',  label: 'Overdue',  icon: AlertTriangle,  color: '#F87171' },
  { key: 'verified', label: 'Verified', icon: CheckCircle2,   color: '#4ADE80' },
]

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const input = 'rounded-lg px-3 py-1.5 text-xs text-white outline-none'
const inputS = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }

/* Only for admins — a mentor's list is already just theirs, and the users
   list behind this picker is not theirs to read. */
function MentorFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useProgramInstructors()
  return (
    <select className={input} style={inputS} value={value} onChange={e => onChange(e.target.value)}>
      <option value="" style={{ background: '#0D0F1A' }}>All mentors</option>
      {(data?.docs ?? []).map((u: { id: string; name: string }) => <option key={u.id} value={u.id} style={{ background: '#0D0F1A' }}>{u.name}</option>)}
    </select>
  )
}

export default function ClassVerificationPage() {
  const { data: me } = useCurrentUser()
  const isMentor = me?.role === 'instructor'
  const [status, setStatus] = useState<VerifyStatus>('pending')
  const [mentorId, setMentorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { data, isLoading, isError } = useVerifyList({ status, mentorId: isMentor ? undefined : mentorId, from, to })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          <ClipboardCheck size={22} />Class Verification
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {isMentor
            ? 'After each class, check who attended and add a short review. Reminders go out 2 hours after the class, and it turns Overdue the next morning.'
            : 'Each mentor checks the attendance and reviews their class after it ends. Overdue classes have not been verified by the next morning.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(t => {
          const on = status === t.key
          const Icon = t.icon
          return (
            <button key={t.key} type="button" onClick={() => setStatus(t.key)}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors"
              style={{ background: on ? 'rgba(255,255,255,0.08)' : 'transparent', color: on ? '#fff' : 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Icon size={14} style={{ color: t.color }} />{t.label}
              <span className="rounded-full px-1.5 text-[11px]" style={{ background: 'rgba(255,255,255,0.08)' }}>{data?.counts?.[t.key] ?? '·'}</span>
            </button>
          )
        })}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!isMentor && me && <MentorFilter value={mentorId} onChange={setMentorId} />}
          <input type="date" className={input} style={inputS} value={from} onChange={e => setFrom(e.target.value)} aria-label="From" />
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>to</span>
          <input type="date" className={input} style={inputS} value={to} onChange={e => setTo(e.target.value)} aria-label="To" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size={22} /></div>
        ) : isError ? (
          <p className="py-16 text-center text-sm" style={{ color: '#F87171' }}>Could not load the classes.</p>
        ) : !data?.rows.length ? (
          <p className="py-16 text-center text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {status === 'verified' ? 'No verified classes yet.' : status === 'overdue' ? 'Nothing overdue.' : 'Nothing waiting — all caught up.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.03)' }}>
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <th className="px-4 py-3 font-semibold">When</th>
                  {!isMentor && <th className="px-4 py-3 font-semibold">Mentor</th>}
                  <th className="px-4 py-3 font-semibold">Students</th>
                  <th className="px-4 py-3 font-semibold">{status === 'verified' ? 'Verified' : 'Status'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id} className="transition-colors hover:bg-white/[0.03]" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td className="px-4 py-3">
                      <Link href={`/class-verification/${r.id}`} className="font-semibold text-white hover:underline">{r.title}</Link>
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {r.course?.title ?? '—'} · {r.isOnline ? 'Online' : 'In person'}{r.language ? ` · ${r.language}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>{when(r.scheduledStart)}</td>
                    {!isMentor && <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>{r.mentor?.name ?? '—'}</td>}
                    <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                      {r.students} · <span style={{ color: '#4ADE80' }}>{r.attended} present</span> · <span style={{ color: '#F87171' }}>{r.missed} absent</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.status === 'verified' ? (
                        <span style={{ color: '#4ADE80' }}>
                          {r.verifiedBy ?? 'No students'}{r.verifiedAt ? ` · ${when(r.verifiedAt)}` : ''}
                          {r.rating ? <> · <Star size={11} className="inline" fill="#F59E0B" style={{ color: '#F59E0B' }} /> {r.rating}</> : null}
                        </span>
                      ) : (
                        <span style={{ color: r.status === 'overdue' ? '#F87171' : '#FBBF24' }}>{r.status === 'overdue' ? 'Overdue' : 'Waiting for the mentor'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/class-verification/${r.id}`} className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#A78BFA' }}>
                        {r.status === 'verified' ? 'View' : 'Verify'}<ChevronRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
