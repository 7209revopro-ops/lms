'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { User, Mail, Lock, Eye, EyeOff, ChevronRight, Zap, BookOpen, CheckCircle2, ArrowRight } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { RequestSection } from '@/components/settings/RequestSection'
import Spinner from '@/components/ui/Spinner'

/* A course bought on /explore: the page opened from the checkout's sign-in link
   (guestCheckout.service, 2026-10-29) — `?from=checkout&course=<slug>`. */
function useCheckout() {
  const params = useSearchParams()
  const slug   = params.get('course') ?? ''
  return {
    fromCheckout: params.get('from') === 'checkout',
    /* Only a plain slug becomes a link. */
    coursePath: /^[a-z0-9-]{1,200}$/i.test(slug) ? `/courses/${slug}` : '/my-learning',
  }
}

function AccountCard() {
  const { data: user, isLoading } = useCurrentUser()
  const { fromCheckout } = useCheckout()
  const [showPw, setShowPw] = useState(false)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-[var(--color-bg-surface)] p-5" style={{ border: '1px solid var(--color-border)' }}>
        <Spinner size={16} />
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading account…</span>
      </div>
    )
  }

  if (!user) return null
  /* Made at checkout: no password, not an Express Account. */
  const checkoutAccount = fromCheckout || !!user.registrationDue

  const field = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: 'rgba(0,87,184,0.07)', border: '1px solid rgba(0,87,184,0.12)' }}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
        <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{value}</div>
      </div>
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-[var(--color-bg-surface)] p-5"
      style={{ border: '1px solid rgba(0,87,184,0.18)', boxShadow: '0 1px 6px rgba(0,87,184,0.06)' }}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: 'rgba(124,58,237,0.1)' }}>
            {checkoutAccount ? <User size={12} style={{ color: '#7C3AED' }} /> : <Zap size={12} style={{ color: '#7C3AED' }} />}
          </div>
          <span className="text-xs font-semibold" style={{ color: '#5B21B6' }}>{checkoutAccount ? 'Your Delta account' : 'Express Account'}</span>
        </div>
        <Link
          href="/settings"
          className="text-xs font-medium transition-colors hover:underline"
          style={{ color: 'var(--color-primary)' }}
        >
          Account settings
        </Link>
      </div>

      {/* Fields */}
      <div className="space-y-3">
        {field(
          <User size={14} style={{ color: 'var(--color-primary)' }} />,
          'Full Name',
          user.name,
        )}
        {field(
          <Mail size={14} style={{ color: 'var(--color-primary)' }} />,
          'Email Address',
          user.email,
        )}
        {!checkoutAccount && field(
          <Lock size={14} style={{ color: 'var(--color-primary)' }} />,
          'Password',
          <div className="flex items-center gap-2">
            <span className="tracking-widest text-base leading-none" style={{ color: 'var(--color-text-secondary)' }}>
              {showPw ? 'your-password' : '••••••••••'}
            </span>
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="transition-colors hover:opacity-70"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <Link
              href="/settings?tab=profile"
              className="ml-1 text-xs font-medium transition-colors hover:underline"
              style={{ color: 'var(--color-primary)' }}
            >
              Change
            </Link>
          </div>,
        )}
      </div>

      {/* Note */}
      <div className="mt-4 rounded-xl px-3 py-2.5 text-xs" style={{
        background: 'rgba(0,87,184,0.04)',
        border: '1px solid rgba(0,87,184,0.10)',
        color: 'var(--color-text-secondary)',
      }}>
        {checkoutAccount
          ? `${user.registrationDue ? 'Your phone number and country from checkout are already filled in below. ' : ''}Your name and email are locked — contact support to change them.`
          : <>Complete the form below to upgrade your Express Account to full membership.
            Your name and email are locked — contact support to change them.</>}
      </div>
    </motion.div>
  )
}

/* Paid on /explore and already approved: the form is asked for, never in the way of the course. */
function CheckoutBanner() {
  const { data: user } = useCurrentUser()
  const { fromCheckout, coursePath } = useCheckout()
  if (!fromCheckout || !user) return null
  const done = !user.registrationDue
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center"
      style={{ background: 'linear-gradient(135deg,rgba(34,197,94,0.08),rgba(34,197,94,0.03))', border: '1.5px solid rgba(34,197,94,0.35)' }}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}>
          <CheckCircle2 size={15} style={{ color: 'var(--color-success)' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {done ? 'Registration complete — you’re all set' : 'Payment received — you’re enrolled'}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {done
              ? 'Your course is open in your account.'
              : 'Your course is already open. Complete your registration below — it takes a few minutes, and your checkout details are filled in.'}
          </p>
        </div>
      </div>
      <Link href={coursePath}
        className={done
          ? 'inline-flex min-h-[44px] flex-shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90'
          : 'inline-flex min-h-[44px] flex-shrink-0 items-center justify-center gap-1 rounded-xl px-3 text-xs font-semibold transition-colors hover:underline'}
        style={done ? { background: 'var(--color-primary)' } : { color: 'var(--color-primary)' }}>
        {done ? 'Open my course' : 'Skip for now — open my course'}
        <ArrowRight size={done ? 14 : 12} />
      </Link>
    </motion.div>
  )
}

function PaymentBanner() {
  const params    = useSearchParams()
  const fromPayment = params.get('from') === 'payment'
  if (!fromPayment) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 flex items-start gap-3"
      style={{ background: 'linear-gradient(135deg,var(--color-primary-light),#DBEAFE)', border: '1.5px solid #93C5FD' }}
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: '#DBEAFE', border: '1px solid #93C5FD' }}>
        <BookOpen size={15} style={{ color: '#1D4ED8' }} />
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: '#1E40AF' }}>
          Complete your registration to access your course
        </p>
        <p className="mt-0.5 text-xs" style={{ color: '#3B82F6' }}>
          Your payment was successful. Fill in your details below and you'll get instant access — no admin wait needed.
        </p>
      </div>
    </motion.div>
  )
}

function Intro() {
  const { fromCheckout } = useCheckout()
  return (
    <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
      {fromCheckout
        ? 'A few details about you for your student record — your course is already open.'
        : 'Fill in your details to unlock full access to courses, live classes, and bookings.'}
    </p>
  )
}

export default function CompleteRegistrationPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-20">

      {/* Page header */}
      <div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <Link href="/my-learning" className="hover:underline">Home</Link>
          <ChevronRight size={12} />
          <span style={{ color: 'var(--color-text-secondary)' }}>Complete Registration</span>
        </div>
        <h1 className="mt-2 text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Complete Your Registration</h1>
        <Suspense fallback={<p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>&nbsp;</p>}>
          <Intro />
        </Suspense>
      </div>

      {/* Payment context banner */}
      <Suspense fallback={null}>
        <PaymentBanner />
        <CheckoutBanner />
      </Suspense>

      {/* Auto-filled account card */}
      <Suspense fallback={null}>
        <AccountCard />
      </Suspense>

      {/* The full enrollment form */}
      <RequestSection />

    </div>
  )
}
