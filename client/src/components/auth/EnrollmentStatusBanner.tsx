'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { XCircle, ChevronRight, Eye, Zap, ArrowRight } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'

const CATEGORY_LABEL: Record<string, string> = {
  '4x-trading':        'FOREX Trading',
  'jura':              'JURA',
  'digital-marketing': 'Digital Marketing',
  'ai':                'AI',
}

export function EnrollmentStatusBanner() {
  const { data: user } = useCurrentUser()
  const pathname = usePathname()

  if (!user || user.role !== 'student') return null
  /* Bought on /explore: approved by the payment, the full registration still to fill — a reminder,
     not a gate (guestCheckout.service, 2026-10-29). Not on the form's own page. */
  if (user.registrationDue && user.enrollmentStatus === 'approved') {
    if (pathname?.startsWith('/complete-registration')) return null
    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        className="mb-4 rounded-xl px-3.5 py-3"
        style={{ background: 'linear-gradient(135deg, rgba(0,87,184,0.07), rgba(0,87,184,0.03))', border: '1px solid rgba(0,87,184,0.22)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>Complete your registration</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="hidden sm:inline">Your course is open. Finish your student profile — your checkout details are already filled in.</span>
              <span className="sm:hidden">Finish your student profile.</span>
            </p>
          </div>
          <Link
            href="/complete-registration"
            className="flex flex-shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
            style={{ background: 'var(--color-primary)', whiteSpace: 'nowrap' }}
          >
            Complete registration
            <ArrowRight size={11} />
          </Link>
        </div>
      </motion.div>
    )
  }
  if (user.enrollmentStatus === 'approved' || !user.enrollmentStatus) return null

  const prog = user.category ? (CATEGORY_LABEL[user.category] ?? user.category) : null
  const isExpress = user.signupType === 'express'

  /* ── Pending ──────────────────────────────────────── */
  if (user.enrollmentStatus === 'pending') {
    /* Express account — nudge to complete full registration */
    if (isExpress) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="mb-4 rounded-xl px-3.5 py-3"
          style={{
            background: 'linear-gradient(135deg, rgba(109,40,217,0.07), rgba(139,92,246,0.05))',
            border: '1px solid rgba(139,92,246,0.25)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
              style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}>
              <Zap size={13} style={{ color: '#7C3AED' }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold" style={{ color: '#5B21B6' }}>
                Express account — unlock full access
              </p>
              <p className="mt-0.5 text-xs" style={{ color: '#6D28D9', opacity: 0.8 }}>
                <span className="hidden sm:inline">
                  Complete your enrollment profile to get approved for courses, live classes, and bookings.
                </span>
                <span className="sm:hidden">Complete your profile to get full access.</span>
              </p>
            </div>
            <Link
              href="/complete-registration"
              className="flex flex-shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', whiteSpace: 'nowrap' }}
            >
              Complete registration
              <ArrowRight size={11} />
            </Link>
          </div>
        </motion.div>
      )
    }

    /* Full registration — existing amber "Viewer mode" banner */
    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        className="mb-4 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5"
        style={{
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.22)',
        }}>
        <Eye size={13} className="flex-shrink-0" style={{ color: '#D97706' }} />
        <p className="min-w-0 flex-1 text-xs font-medium" style={{ color: '#92400E' }}>
          <span className="font-semibold">Viewer mode</span>
          <span className="hidden sm:inline">
            {prog ? `: ${prog} approval pending` : ': account approval pending'}. Content locked until approved.
          </span>
          <span className="sm:hidden">: pending approval</span>
        </p>
        <ChevronRight size={13} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
      </motion.div>
    )
  }

  /* ── Cancelled / Rejected ─────────────────────────── */
  if (user.enrollmentStatus === 'cancelled' || (user.enrollmentStatus as string) === 'rejected') {
    const reason = user.enrollmentCancellationReason ?? (user as any).rejectionReason
    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        className="mb-4 rounded-xl px-3.5 py-3"
        style={{
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.20)',
        }}>
        <div className="flex items-center gap-2.5">
          <XCircle size={13} className="flex-shrink-0" style={{ color: 'var(--color-danger)' }} />
          <p className="min-w-0 flex-1 text-xs font-medium" style={{ color: '#991B1B' }}>
            <span className="font-semibold">Application not approved</span>
            <span className="hidden sm:inline">
              {prog ? ` — ${prog} request was rejected` : ''}. Reapply to regain access.
            </span>
          </p>
          <Link
            href="/complete-registration"
            className="flex flex-shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--color-danger), var(--color-danger))', whiteSpace: 'nowrap' }}
          >
            Reapply
            <ArrowRight size={11} />
          </Link>
        </div>
        {reason && (
          <p className="mt-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="font-semibold" style={{ color: 'var(--color-danger)' }}>Reason: </span>{reason}
          </p>
        )}
      </motion.div>
    )
  }

  return null
}
