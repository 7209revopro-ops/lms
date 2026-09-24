'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Loader2 } from 'lucide-react'
import {
  useCurrentUser, useUpdateEmailPrefs, effectiveEmailPref,
  type StaffEmailCategory,
} from '@/lib/api/user'

/* Which categories a role can actually receive.

   The two admin alerts go to super_admin/admin/sub_admin/support only, so a
   pure instructor never sees them. The "classes you teach" group is shown to
   everyone, because ANY staff member can be set as a class's instructor of
   record — hiding those rows would leave someone unable to silence mail they
   are in fact receiving. */
const ADMIN_ALERT_ROLES = new Set(['super_admin', 'admin', 'sub_admin', 'support'])

/* `roles` narrows a row to the roles that can actually receive it. The evening
   schedule goes to the `instructor` role only (by decision — an admin who is
   the instructor of record on a class does not get it), so offering the switch
   to anyone else would be a control that does nothing. */
const GROUPS: { heading: string; rows: { key: StaffEmailCategory; label: string; hint: string; roles?: string[] }[] }[] = [
  {
    heading: 'Administration',
    rows: [
      { key: 'enrollmentRequest', label: 'New student sign-ups', hint: 'A student registers and is waiting for approval.' },
      { key: 'deviceApproval',    label: 'Device approval requests', hint: 'A student is blocked signing in on a new device.' },
    ],
  },
  {
    heading: 'Classes you teach',
    rows: [
      { key: 'classScheduled',      label: 'Class scheduled',      hint: 'You are assigned as the instructor for a new session.' },
      { key: 'classReminder',       label: 'Class starting soon',  hint: 'A reminder 15 minutes before your session begins.' },
      { key: 'dailySchedule',       label: "Tomorrow's schedule",  hint: 'Every evening at 9 PM, your classes and meetings for the next day.', roles: ['instructor'] },
      { key: 'assignmentSubmitted', label: 'Assignment submitted', hint: 'A student submits or revises an assignment for review.' },
    ],
  },
]

/* ─── Switch ─────────────────────────────────────────── */
function Switch({ on, disabled, busy, onChange }: {
  on: boolean; disabled?: boolean; busy?: boolean; onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled || busy}
      onClick={() => onChange(!on)}
      className="relative h-6 w-11 shrink-0 rounded-full transition-all disabled:opacity-40"
      style={{
        background: on ? 'linear-gradient(135deg,#0057b8,#2F6BFF)' : 'rgba(255,255,255,0.12)',
        border: `1px solid ${on ? 'rgba(0,87,184,0.5)' : 'rgba(255,255,255,0.12)'}`,
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
      }}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        className="absolute top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-white"
        style={{ left: on ? 'calc(100% - 20px)' : 4 }}
      >
        {busy && <Loader2 size={9} className="animate-spin" style={{ color: '#0057b8' }} />}
      </motion.span>
    </button>
  )
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>{hint}</p>
      </div>
      {children}
    </div>
  )
}

export function EmailNotificationsSection() {
  const { data: me, isLoading } = useCurrentUser()
  const update = useUpdateEmailPrefs()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (isLoading || !me) {
    return <p className="py-3 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading your preferences…</p>
  }

  const masterOn = me.emailPrefs?.masterEnabled !== false
  const visible = GROUPS.filter(g => g.heading !== 'Administration' || ADMIN_ALERT_ROLES.has(me.role))

  const save = async (key: string, patch: Parameters<typeof update.mutateAsync>[0]) => {
    setPending(key); setError(null)
    try { await update.mutateAsync(patch) }
    catch { setError('Could not save that change. Please try again.') }
    finally { setPending(null) }
  }

  return (
    <div>
      {/* Master switch */}
      <Row
        label="Email notifications"
        hint={masterOn
          ? 'Turn this off to stop all notification emails to your address.'
          : 'All notification emails to your address are currently paused.'}
      >
        <Switch
          on={masterOn}
          busy={pending === 'master'}
          onChange={next => save('master', { masterEnabled: next })}
        />
      </Row>

      {visible.map(group => (
        <div key={group.heading}>
          <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <p className="pt-3 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: masterOn ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.18)' }}>
            {group.heading}
          </p>
          {group.rows.filter(row => !row.roles || row.roles.includes(me.role)).map(row => (
            <Row key={row.key} label={row.label} hint={row.hint}>
              <Switch
                on={effectiveEmailPref(me, row.key)}
                disabled={!masterOn}
                busy={pending === row.key}
                onChange={next => save(row.key, { categories: { [row.key]: next } })}
              />
            </Row>
          ))}
        </div>
      ))}

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}>
            <AlertCircle size={13} />{error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
