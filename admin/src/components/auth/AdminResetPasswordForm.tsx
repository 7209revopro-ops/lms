'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock, Eye, EyeOff, ArrowRight, ArrowLeft, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

/* Mirrors the backend adminResetSchema: min 8, one uppercase, one number. */
const schema = z.object({
  password: z.string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Add an uppercase letter')
    .regex(/[0-9]/, 'Add a number'),
  confirm: z.string(),
}).refine(v => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
type Values = z.infer<typeof schema>

const fieldVariant = {
  hidden:  { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24, delay: i * 0.07 },
  }),
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { error?: { message?: string; code?: string } } } }).response
    const code = resp?.data?.error?.code
    if (code === 'INVALID_RESET_TOKEN') return 'This reset link is invalid or has expired. Request a new one.'
    if (resp?.data?.error?.message) return resp.data.error.message
  }
  return 'Unable to reset your password right now. Please try again.'
}

export function AdminResetPasswordForm() {
  const router = useRouter()
  const sp = useSearchParams()
  /* Capture the token once, then strip it from the address bar so it does not
     linger in browser history or get picked up by Session Replay's URL capture. */
  const [token] = useState(() => sp.get('token') ?? '')
  useEffect(() => {
    if (token && typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [token])
  const [error, setError] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)
  const [done, setDone] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async ({ password }: Values) => {
    setError(null)
    try {
      await api.post('/admin/auth/reset-password', { token, password })
      setDone(true)
      setTimeout(() => { router.replace('/login') }, 2200)
    } catch (err) {
      setError(extractErrorMessage(err))
    }
  }

  /* ── Missing token ── */
  if (!token) {
    return (
      <div className="w-full max-w-[400px]">
        <div className="mb-6 inline-flex items-center justify-center rounded-2xl p-3"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.24)' }}>
          <AlertCircle size={24} color="#EF4444" strokeWidth={2} />
        </div>
        <h1 className="mb-2 text-[28px] font-bold leading-tight tracking-tight text-white"
          style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Invalid reset link
        </h1>
        <p className="mb-8 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
          This link is missing its token. Please request a new password-reset email.
        </p>
        <Link href="/forgot-password"
          className="inline-flex items-center gap-1 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: '#0057b8' }}>
          <ArrowLeft size={14} />
          Request a new link
        </Link>
      </div>
    )
  }

  /* ── Success state ── */
  if (done) {
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
          Password updated
        </h1>
        <p className="mb-8 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Your password has been reset. Redirecting you to sign in…
        </p>
        <Link href="/login"
          className="inline-flex items-center gap-1 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,255,255,0.55)' }}>
          <ArrowLeft size={14} />
          Go to sign in
        </Link>
      </div>
    )
  }

  const pwField = (name: 'password' | 'confirm', label: string, index: number, autoFocus = false) => (
    <motion.div custom={index} variants={fieldVariant} initial="hidden" animate="visible">
      <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
        {label}
      </label>
      <div className="relative">
        <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2"
          style={{ color: errors[name] ? '#EF4444' : 'rgba(255,255,255,0.3)' }} />
        <input
          {...register(name)}
          type={showPw ? 'text' : 'password'}
          autoFocus={autoFocus}
          placeholder={name === 'password' ? 'New password' : 'Re-enter new password'}
          className="w-full rounded-xl py-3 pl-10 pr-11 text-sm text-white outline-none transition-all placeholder:text-white/25"
          style={{
            background: errors[name] ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)',
            border: `1.5px solid ${errors[name] ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`,
          }}
          onFocus={e => {
            e.currentTarget.style.border = '1.5px solid rgba(0,87,184,0.6)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.09)'
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.12)'
          }}
          onBlur={e => {
            e.currentTarget.style.border = `1.5px solid ${errors[name] ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`
            e.currentTarget.style.background = errors[name] ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        />
        {name === 'password' && (
          <button type="button" onClick={() => setShowPw(v => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
            style={{ color: 'rgba(255,255,255,0.3)' }}>
            {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      <AnimatePresence>
        {errors[name] && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: '#EF4444' }}>
            <AlertCircle size={11} />{errors[name]?.message}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )

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
        <span className="text-xs font-semibold" style={{ color: '#0057b8' }}>Set a new password</span>
      </motion.div>

      {/* Heading */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="mb-8">
        <h1 className="mb-2 text-[32px] font-bold leading-tight tracking-tight text-white"
          style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Choose a new password
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>
          At least 8 characters, with an uppercase letter and a number
        </p>
      </motion.div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {pwField('password', 'New password', 0, true)}
        {pwField('confirm', 'Confirm password', 1)}

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
        <motion.div custom={2} variants={fieldVariant} initial="hidden" animate="visible">
          <motion.button type="submit" disabled={isSubmitting}
            whileHover={{ y: -2, boxShadow: '0 10px 32px rgba(0,87,184,0.42)' }}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 24px rgba(0,87,184,0.32)' }}>
            {isSubmitting ? <><Spinner size={16} />Updating…</> : <>Reset password<ArrowRight size={16} /></>}
          </motion.button>
        </motion.div>
      </form>

      {/* Back to sign in */}
      <motion.div custom={3} variants={fieldVariant} initial="hidden" animate="visible" className="mt-6 text-center">
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
