'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, Plus, Trash2, Save, CheckCircle, CalendarDays } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useMyAvailability, useUpdateMyAvailability, type AvailabilitySlot } from '@/lib/api/liveClasses'
import { useCurrentUser } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function defaultSlot(dayOfWeek: number): AvailabilitySlot {
  return { dayOfWeek, startTime: '09:00', endTime: '10:00' }
}

/* ── Day row ──────────────────────────────────────────── */
function DayRow({
  day, slots, onChange, onAdd, onRemove,
}: {
  day:      number
  slots:    AvailabilitySlot[]
  onChange: (idx: number, field: 'startTime' | 'endTime', value: string) => void
  onAdd:    () => void
  onRemove: (idx: number) => void
}) {
  /* The panel and control colours the rest of this app uses. There are no
     theme tokens here — every surface is an inline hex — so this page had a
     white card and near-black text sitting in a dark dashboard, which is how
     it came to look like somebody else's screen. */
  const PANEL   = '#1a1d2e'
  const SURFACE = '#1e2035'
  const BORDER  = 'rgba(255,255,255,0.12)'
  const TEXT    = '#E8EAF2'

  const inputBase = 'rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-[#0057b8] focus:ring-2 focus:ring-[rgba(0,87,184,0.35)] transition-all [color-scheme:dark]'
  const inputStyle = { background: SURFACE, borderColor: BORDER, color: TEXT }

  return (
    <div className="rounded-2xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ background: slots.length > 0 ? 'linear-gradient(135deg,#0057b8,#003d80)' : 'rgba(255,255,255,0.14)' }}>
            {SHORT_DAYS[day]}
          </div>
          <p className="text-sm font-semibold" style={{ color: TEXT }}>{DAYS[day]}</p>
          {slots.length > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}>
              {slots.length} slot{slots.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {slots.length < 3 && (
          <button onClick={onAdd}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-[rgba(0,87,184,0.15)]"
            style={{ color: '#0057b8', border: '1px solid rgba(0,87,184,0.25)' }}>
            <Plus size={11} />Add slot
          </button>
        )}
      </div>

      {slots.length === 0 ? (
        <p className="text-xs py-1" style={{ color: '#9CA3AF' }}>No slots — click "Add slot" to set availability</p>
      ) : (
        <div className="space-y-2">
          {slots.map((slot, idx) => {
            const invalid = timeToMinutes(slot.startTime) >= timeToMinutes(slot.endTime)
            return (
              <div key={idx} className="flex items-center gap-2">
                <Clock size={12} style={{ color: '#9CA3AF', flexShrink: 0 }} />
                <input type="time" value={slot.startTime}
                  onChange={e => onChange(idx, 'startTime', e.target.value)}
                  className={inputBase} style={inputStyle} />
                <span className="text-xs" style={{ color: '#9CA3AF' }}>to</span>
                <input type="time" value={slot.endTime}
                  onChange={e => onChange(idx, 'endTime', e.target.value)}
                  className={`${inputBase} ${invalid ? 'ring-2 ring-red-300 border-red-300' : ''}`}
                  style={invalid ? { ...inputStyle, borderColor: '#EF4444' } : inputStyle} />
                {invalid && (
                  <span className="text-[10px] font-medium" style={{ color: '#EF4444' }}>End must be after start</span>
                )}
                <button onClick={() => onRemove(idx)}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[rgba(239,68,68,0.15)]"
                  style={{ color: '#EF4444' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────── */
export default function AvailabilityPage() {
  const { data: me } = useCurrentUser()
  const { data: availability, isLoading } = useMyAvailability()
  const updateMutation = useUpdateMyAvailability()

  const [slots, setSlots] = useState<AvailabilitySlot[]>([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Sync from server when loaded */
  useEffect(() => {
    if (availability) setSlots(availability.slots ?? [])
  }, [availability])

  /* Group slots by day */
  const byDay: Record<number, AvailabilitySlot[]> = {}
  for (let d = 0; d < 7; d++) byDay[d] = []
  for (const s of slots) {
    const arr = byDay[s.dayOfWeek]
    if (arr) arr.push(s)
  }

  const handleChange = (day: number, idx: number, field: 'startTime' | 'endTime', value: string) => {
    const daySlots = byDay[day] ?? []
    const newDaySlots = daySlots.map((s, i) => i === idx ? { ...s, [field]: value } : s)
    setSlots(slots.filter(s => s.dayOfWeek !== day).concat(newDaySlots))
  }

  const handleAdd = (day: number) => {
    const daySlots = byDay[day] ?? []
    if (daySlots.length >= 3) return
    setSlots([...slots, defaultSlot(day)])
  }

  const handleRemove = (day: number, idx: number) => {
    const daySlots = byDay[day] ?? []
    const newDaySlots = daySlots.filter((_, i) => i !== idx)
    setSlots(slots.filter(s => s.dayOfWeek !== day).concat(newDaySlots))
  }

  const handleSave = async () => {
    setError(null)
    // Validate no invalid slots
    const invalid = slots.some(s => timeToMinutes(s.startTime) >= timeToMinutes(s.endTime))
    if (invalid) { setError('All slots must have an end time after start time'); return }
    try {
      await updateMutation.mutateAsync(slots)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to save availability')
    }
  }

  const totalSlots = slots.length

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 text-sm" style={{ color: '#9CA3AF' }}>
        <Spinner size={16} />Loading availability…
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <PageHeader
          title="My Availability"
          subtitle="Set weekly time slots when you can mentor sessions"
          badge={{ label: 'Schedule', color: '#0057b8' }}
        />
        <motion.button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          whileHover={{ y: -1, boxShadow: '0 6px 20px rgba(0,87,184,0.28)' }}
          whileTap={{ scale: 0.97 }}
          className="mt-1 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white flex-shrink-0 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)' }}>
          {updateMutation.isPending
            ? <><Spinner size={15} />Saving…</>
            : saved
            ? <><CheckCircle size={15} />Saved!</>
            : <><Save size={15} />Save</>}
        </motion.button>
      </div>

      {/* Info banner */}
      <div className="mb-5 flex items-start gap-3 rounded-2xl px-4 py-3"
        style={{ background: 'rgba(0,87,184,0.06)', border: '1px solid rgba(0,87,184,0.15)' }}>
        <CalendarDays size={15} style={{ color: '#0057b8', marginTop: 1, flexShrink: 0 }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#E8EAF2' }}>Weekly recurring schedule</p>
          <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
            These slots repeat every week. Admins use them to schedule sessions that match your availability.
            Maximum 3 slots per day.
          </p>
        </div>
        {totalSlots > 0 && (
          <span className="ml-auto flex-shrink-0 rounded-xl px-2.5 py-1 text-xs font-bold"
            style={{ background: 'rgba(0,87,184,0.12)', color: '#0057b8' }}>
            {totalSlots} slot{totalSlots !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mb-4 rounded-xl px-4 py-2.5 text-sm"
            style={{ background: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.20)' }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Day rows */}
      <div className="grid gap-3">
        {[1, 2, 3, 4, 5, 6, 0].map(day => (
          <DayRow
            key={day}
            day={day}
            slots={byDay[day] ?? []}
            onChange={(idx, field, value) => handleChange(day, idx, field, value)}
            onAdd={() => handleAdd(day)}
            onRemove={(idx) => handleRemove(day, idx)}
          />
        ))}
      </div>

      {/* Summary */}
      {totalSlots > 0 && (
        <p className="mt-4 text-xs" style={{ color: '#9CA3AF' }}>
          {totalSlots} slot{totalSlots !== 1 ? 's' : ''} across {Object.values(byDay).filter(d => d.length > 0).length} day{Object.values(byDay).filter(d => d.length > 0).length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
