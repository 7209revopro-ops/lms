'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Flame, Trophy, Calendar, Zap, Target, ChevronLeft, ChevronRight,
  Check, TrendingUp,
} from 'lucide-react'
import { useMyStreak, useUpdateStreakGoal } from '@/lib/api/streaks'
import Spinner from '@/components/ui/Spinner'

/* ─── Helpers ──────────────────────────────────────────── */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/* Returns the most-recent Monday for a given date */
function getMondayOf(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  const day = copy.getDay() // 0 = Sun
  copy.setDate(copy.getDate() - ((day + 6) % 7))
  return copy
}

/* Week calendar — 7 day slots from weekStartDate */
function WeekCalendar({ weekStartDate, weekProgress }: { weekStartDate: string; weekProgress: number }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Guard: fall back to current Monday when weekStartDate is absent or invalid
  const parsed = weekStartDate ? new Date(weekStartDate) : null
  const start  = parsed && !isNaN(parsed.getTime()) ? parsed : getMondayOf(today)

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const isPast  = d < today
    const isToday = d.getTime() === today.getTime()
    /* "active" approximation: past days within the first weekProgress slots */
    const isActive = i < weekProgress && isPast
    return {
      d,
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      num:   d.getDate(),
      isToday,
      isActive,
    }
  })

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map(({ d, label, num, isToday, isActive }) => (
        <div key={d.toISOString()} className="flex flex-col items-center gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: isToday ? '#0057b8' : 'var(--color-text-muted)' }}>
            {label}
          </p>
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl transition-all"
            style={{
              background: isActive
                ? '#0057b8'
                : isToday
                  ? 'rgba(0,87,184,0.12)'
                  : 'var(--color-bg-page)',
              border: isToday ? '2px solid rgba(0,87,184,0.40)' : '2px solid transparent',
            }}>
            {isActive
              ? <Check size={14} style={{ color: 'white' }} />
              : <span className="text-xs font-bold" style={{ color: isToday ? '#0057b8' : 'var(--color-text-muted)' }}>{num}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── Stat tile ────────────────────────────────────────── */
function StatTile({
  icon: Icon, label, value, sub, color,
}: {
  icon: React.ElementType; label: string; value: React.ReactNode; sub?: string; color: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-[var(--color-bg-surface)] p-5 flex flex-col gap-3"
      style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl"
        style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          {value}
        </p>
        <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
      </div>
    </motion.div>
  )
}

/* ─── Goal editor ──────────────────────────────────────── */
function GoalEditor({ current }: { current: number }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(current)
  const [saved,   setSaved]   = useState(false)
  const update = useUpdateStreakGoal()

  const save = async () => {
    await update.mutateAsync(value)
    setSaved(true)
    setEditing(false)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="rounded-2xl bg-[var(--color-bg-surface)] p-5" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target size={16} style={{ color: 'var(--color-primary)' }} />
          <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Weekly goal</h3>
        </div>
        {saved ? (
          <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-success)' }}>
            <Check size={11} />Saved!
          </span>
        ) : !editing ? (
          <button onClick={() => { setValue(current); setEditing(true) }}
            aria-label="Edit weekly goal"
            className="-mr-2 inline-flex min-h-[44px] items-center rounded-lg px-2 text-[13px] font-semibold transition-opacity hover:opacity-70 sm:-mr-0 sm:min-h-0 sm:px-0 sm:text-xs"
            style={{ color: 'var(--color-primary)' }}>
            Edit
          </button>
        ) : null}
      </div>

      <AnimatePresence mode="wait">
        {editing ? (
          <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Set how many lessons you want to complete each week.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={50}
                value={value}
                onChange={e => setValue(Math.max(1, Math.min(50, Number(e.target.value))))}
                className="w-24 rounded-xl px-3 py-2 text-center text-lg font-bold outline-none"
                style={{ background: 'var(--color-bg-page)', border: '1.5px solid var(--color-primary)', color: 'var(--color-text-primary)' }}
              />
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>lessons / week</span>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={save} disabled={update.isPending}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all disabled:opacity-60"
                style={{ background: 'var(--color-primary)' }}>
                {update.isPending ? <Spinner size={12} /> : <Check size={12} />}
                {update.isPending ? 'Saving…' : 'Save goal'}
              </button>
              <button onClick={() => setEditing(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
                style={{ color: 'var(--color-text-muted)' }}>
                Cancel
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="display" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-end gap-3">
              <p className="text-4xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                {current}
              </p>
              <p className="mb-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>lessons / week</p>
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Keep showing up every day and you&apos;ll hit it easily.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────── */
export default function StreaksPage() {
  const { data, isLoading } = useMyStreak()

  if (isLoading) {
    return (
      <div className="flex h-60 items-center justify-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        <Spinner size={16} />Loading your streak…
      </div>
    )
  }

  if (!data) return null

  const progressPct = data.weeklyGoal > 0
    ? Math.min(100, Math.round((data.weekProgress / data.weeklyGoal) * 100))
    : 0

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <Flame size={22} style={{ color: 'var(--color-danger)' }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Learning Streak
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Keep the flame alive. Consistency is everything.
          </p>
        </div>

        {data.currentStreak >= 7 && (
          <motion.div
            animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 2.4, repeat: Infinity }}
            className="ml-auto flex items-center gap-2 rounded-2xl px-3.5 py-2"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <Flame size={16} style={{ color: 'var(--color-danger)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--color-danger)' }}>
              {data.currentStreak} day streak!
            </span>
          </motion.div>
        )}
      </motion.div>

      {/* ── Stat tiles ─────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          icon={Flame}
          label="Current streak"
          value={`${data.currentStreak}d`}
          sub={data.currentStreak === 0 ? 'Learn today to start!' : 'keep it going'}
          color="#EF4444"
        />
        <StatTile
          icon={Trophy}
          label="Longest streak"
          value={`${data.longestStreak}d`}
          sub="your best run"
          color="#F59E0B"
        />
        <StatTile
          icon={TrendingUp}
          label="Total days"
          value={data.totalDaysActive.toLocaleString()}
          sub="days with activity"
          color="#6366F1"
        />
        <StatTile
          icon={Zap}
          label="This week"
          value={`${data.weekProgress}/${data.weeklyGoal}`}
          sub={`${progressPct}% of goal`}
          color="#10B981"
        />
      </div>

      {/* ── Weekly progress ─────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="mb-6 rounded-2xl bg-[var(--color-bg-surface)] p-6"
        style={{ border: '1px solid var(--color-border)' }}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={15} style={{ color: 'var(--color-primary)' }} />
            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>This week</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              week of {data.weekStartDate ? fmtDate(data.weekStartDate) : '—'}
            </span>
          </div>
        </div>

        <WeekCalendar weekStartDate={data.weekStartDate} weekProgress={data.weekProgress} />

        {/* Progress bar */}
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span style={{ color: 'var(--color-text-muted)' }}>{data.weekProgress} of {data.weeklyGoal} lessons done</span>
            <span className="font-bold" style={{ color: progressPct >= 100 ? '#10B981' : '#0057b8' }}>
              {progressPct}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-page)' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: progressPct >= 100 ? '#10B981' : '#0057b8' }}
            />
          </div>
          {progressPct >= 100 && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
              className="mt-2 text-xs font-semibold" style={{ color: 'var(--color-success)' }}>
              🎉 Weekly goal complete! You crushed it.
            </motion.p>
          )}
        </div>
      </motion.div>

      {/* ── Bottom row: goal + last active ─────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GoalEditor current={data.weeklyGoal} />

        <div className="rounded-2xl bg-[var(--color-bg-surface)] p-5" style={{ border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} style={{ color: '#6366F1' }} />
            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Activity info</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Last active</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {fmtDate(data.lastActiveDate)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Total days active</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {data.totalDaysActive.toLocaleString()} days
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Longest streak</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--color-warning)' }}>
                {data.longestStreak} {data.longestStreak === 1 ? 'day' : 'days'}
              </span>
            </div>
            <div className="h-px" style={{ background: 'var(--color-bg-page)' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              Your streak increments each day you complete at least one lesson.
              Missing a day resets your current streak, but your longest streak is
              preserved forever.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
