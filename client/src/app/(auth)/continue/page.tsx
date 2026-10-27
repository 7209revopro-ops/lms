'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { AlertCircle, Sparkles } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

/* Only allow same-origin internal paths as the post-login destination — never
   an absolute URL an attacker could put in the link (open-redirect guard). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/class-bookings'
  return raw
}

function ContinueInner() {
  const params = useSearchParams()
  const token  = params.get('token') ?? ''
  const next   = safeNext(params.get('next'))
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const ran = useRef(false) // login-link is single-use; guard StrictMode double-invoke

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    async function run() {
      if (!token) {
        setErrorMsg('This sign-in link is missing its token. Sign in with your email instead.')
        return
      }
      try {
        await api.post('/auth/login-link/redeem', { token })
        // Full navigation so the new httpOnly session cookie is used everywhere.
        window.location.href = next
      } catch (err: any) {
        setErrorMsg(err?.response?.data?.error?.message ?? 'This sign-in link is invalid or has expired.')
      }
    }
    void run()
  }, [token, next])

  if (!errorMsg) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Spinner size={26} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Signing you in…</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
        style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)' }}>
        <AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />
      </div>
      <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Sign-in link problem</p>
      <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-muted)' }}>{errorMsg}</p>
      <Link href="/login?method=email" className="mt-3 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
        style={{ background: 'var(--color-primary)' }}>
        Sign in with email
      </Link>
    </div>
  )
}

export default function ContinuePage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10" style={{ background: 'var(--color-bg-page)' }}>
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="w-full max-w-[460px] rounded-3xl bg-[var(--color-bg-surface)] p-8"
        style={{ border: '1px solid var(--color-border)', boxShadow: '0 24px 80px rgba(13,15,26,0.08)' }}>
        <div className="mb-2 flex items-center gap-2">
          <Sparkles size={16} style={{ color: 'var(--color-primary)' }} />
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>
            Delta AI Academy
          </span>
        </div>
        <Suspense fallback={<div className="h-[160px]" />}>
          <ContinueInner />
        </Suspense>
      </motion.div>
    </div>
  )
}
