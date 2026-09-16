'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, ArrowRight, ArrowLeft, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

const schema = z.object({ email: z.string().email('Enter a valid email') })
type Values = z.infer<typeof schema>

const fieldVariant = {
  hidden:  { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24, delay: i * 0.07 },
  }),
}

export function AdminForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async ({ email }: Values) => {
    setError(null)
    try {
      /* Always 200 (enumeration-safe) — show the confirmation regardless. */
      await api.post('/admin/auth/forgot-password', { email })
      setSentTo(email)
    } catch {
      setError('Unable to send the reset link right now. Please try again.')
    }
  }

  /* ── Success state ── */
  if (sentTo) {
    return (
      <div className="w-full max-w-[400px]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          className="mb-6 inline-flex items-center justify-center rounded-2xl p-3"
          style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.24)' }}
        >
          <CheckCircle2 size={24} color="#22C55E" strokeWidth={2} />
        </motion.div>
        <h1 className="mb-2 text-[28px] font-bold leading-tight tracking-tight text-white"
          style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Check your email
        </h1>
        <p className="mb-1 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
          If a staff account exists for
        </p>
        <p className="mb-6 text-sm font-semibold" style={{ color: '#fff' }}>{sentTo}</p>
        <p className="mb-8 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
          we&apos;ve sent a password-reset link. It expires in 60 minutes. Check your spam folder if you don&apos;t see it.
        </p>
        <Link href="/login"
          className="inline-flex items-center gap-1 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,255,255,0.55)' }}>
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[400px]">
      {/* Badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        className="mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2"
        style={{ background: 'rgba(0,87,184,0.12)', border: '1px solid rgba(0,87,184,0.24)' }}
      >
        <KeyRound size={14} color="#0057b8" strokeWidth={2} />
        <span className="text-xs font-semibold" style={{ color: '#0057b8' }}>Reset your password</span>
      </motion.div>

      {/* Heading */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="mb-8">
        <h1 className="mb-2 text-[32px] font-bold leading-tight tracking-tight text-white"
          style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Forgot password?
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>
          Enter your email and we&apos;ll send you a reset link
        </p>
      </motion.div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {/* Email */}
        <motion.div custom={0} variants={fieldVariant} initial="hidden" animate="visible">
          <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Email address
          </label>
          <div className="relative">
            <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: errors.email ? '#EF4444' : 'rgba(255,255,255,0.3)' }} />
            <input
              {...register('email')}
              type="email"
              autoFocus
              placeholder="you@deltagroups.ae"
              className="w-full rounded-xl py-3 pl-10 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/25"
              style={{
                background: errors.email ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)',
                border: `1.5px solid ${errors.email ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`,
              }}
              onFocus={e => {
                e.currentTarget.style.border = '1.5px solid rgba(0,87,184,0.6)'
                e.currentTarget.style.background = 'rgba(255,255,255,0.09)'
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.12)'
              }}
              onBlur={e => {
                e.currentTarget.style.border = `1.5px solid ${errors.email ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`
                e.currentTarget.style.background = errors.email ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>
          <AnimatePresence>
            {errors.email && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: '#EF4444' }}>
                <AlertCircle size={11} />{errors.email.message}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Server error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}>
              <AlertCircle size={15} />{error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit */}
        <motion.div custom={1} variants={fieldVariant} initial="hidden" animate="visible">
          <motion.button type="submit" disabled={isSubmitting}
            whileHover={{ y: -2, boxShadow: '0 10px 32px rgba(0,87,184,0.42)' }}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 24px rgba(0,87,184,0.32)' }}>
            {isSubmitting ? <><Spinner size={16} />Sending…</> : <>Send reset link<ArrowRight size={16} /></>}
          </motion.button>
        </motion.div>
      </form>

      {/* Back to sign in */}
      <motion.div custom={2} variants={fieldVariant} initial="hidden" animate="visible" className="mt-6 text-center">
        <Link href="/login"
          className="inline-flex items-center gap-1 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,255,255,0.55)' }}>
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </motion.div>
    </div>
  )
}
