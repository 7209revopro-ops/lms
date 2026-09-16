'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, AlertCircle, Shield } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

const schema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})
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
    const msg  = resp?.data?.error?.message

    if (code === 'NOT_ADMIN' || code === 'FORBIDDEN') {
      return 'This account does not have admin or instructor access.'
    }
    if (code === 'INVALID_CREDENTIALS' || code === 'ACCOUNT_LOCKED') {
      return msg ?? 'Incorrect email or password.'
    }
    if (msg) return msg
  }
  return 'Unable to sign in. Please try again.'
}

export function AdminLoginForm() {
  const router   = useRouter()
  const [showPw, setShowPw] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  /* 2FA challenge step — set when the backend answers with twoFactorRequired */
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [code,           setCode]           = useState('')
  const [verifying,      setVerifying]      = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
  })

  /* ── Post-login handling (shared by password + 2FA paths) ── */
  const completeLogin = () => {
    router.replace('/')
    router.refresh()
  }

  const onSubmit = async ({ email, password }: Values) => {
    setError(null)
    try {
      const res = await api.post<{
        success: true
        data: { user?: { role: string }; twoFactorRequired?: boolean; challengeToken?: string }
      }>('/admin/auth/login', { email, password })

      // 2FA accounts get a short-lived challenge instead of a session.
      const payload = res.data?.data
      if (payload?.twoFactorRequired) {
        if (!payload.challengeToken) {
          setError('Unable to start two-factor verification. Please try again.')
          return
        }
        setCode('')
        setChallengeToken(payload.challengeToken)
        return
      }

      completeLogin()
    } catch (err) {
      setError(extractErrorMessage(err))
    }
  }

  /* ── 2FA verification handler ── */
  const onVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!challengeToken || verifying) return
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setError(null)
    setVerifying(true)
    try {
      await api.post<{
        success: true
        data: { user?: { role: string } }
      }>('/admin/auth/login/2fa', { challengeToken, code })

      completeLogin()
    } catch (err) {
      setError(extractErrorMessage(err))
      setCode('')
    } finally {
      setVerifying(false)
    }
  }

  /* ── Back to the credentials step ── */
  const cancelChallenge = () => {
    setChallengeToken(null)
    setCode('')
    setError(null)
  }

  /* ── 2FA challenge step ── */
  if (challengeToken) {
    return (
      <div className="w-full max-w-[400px]">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          className="mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2"
          style={{ background: 'rgba(0,87,184,0.12)', border: '1px solid rgba(0,87,184,0.24)' }}
        >
          <Shield size={14} color="#0057b8" strokeWidth={2} />
          <span className="text-xs font-semibold" style={{ color: '#0057b8' }}>Two-Factor Verification</span>
        </motion.div>

        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="mb-8"
        >
          <h1
            className="mb-2 text-[32px] font-bold leading-tight tracking-tight text-white"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
          >
            Verify it&apos;s you
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>
            Enter the 6-digit code from your authenticator app
          </p>
        </motion.div>

        <form onSubmit={onVerify} noValidate className="space-y-4">
          {/* Code */}
          <motion.div custom={0} variants={fieldVariant} initial="hidden" animate="visible">
            <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Authentication code
            </label>
            <div className="relative">
              <Shield size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2"
                style={{ color: error ? '#EF4444' : 'rgba(255,255,255,0.3)' }} />
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                placeholder="000000"
                className="w-full rounded-xl py-3 pl-10 pr-4 text-sm tracking-[0.4em] text-white outline-none transition-all placeholder:text-white/25"
                style={{
                  background: error ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)',
                  border: `1.5px solid ${error ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`,
                }}
                onFocus={e => {
                  e.currentTarget.style.border = '1.5px solid rgba(0,87,184,0.6)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.09)'
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.12)'
                }}
                onBlur={e => {
                  e.currentTarget.style.border = `1.5px solid ${error ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`
                  e.currentTarget.style.background = error ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            </div>
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
            <motion.button type="submit" disabled={verifying}
              whileHover={{ y: -2, boxShadow: '0 10px 32px rgba(0,87,184,0.42)' }}
              whileTap={{ scale: 0.98 }}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 24px rgba(0,87,184,0.32)' }}>
              {verifying
                ? <><Spinner size={16} />Verifying…</>
                : <>Verify code<ArrowRight size={16} /></>}
            </motion.button>
          </motion.div>
        </form>

        {/* Back to sign in */}
        <motion.div custom={2} variants={fieldVariant} initial="hidden" animate="visible" className="mt-6 text-center">
          <button type="button" onClick={cancelChallenge}
            className="inline-flex items-center gap-1 text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft size={14} />
            Back to sign in
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[400px]">
      {/* Badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        className="mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2"
        style={{ background: 'rgba(0,87,184,0.12)', border: '1px solid rgba(0,87,184,0.24)' }}
      >
        <Shield size={14} color="#0057b8" strokeWidth={2} />
        <span className="text-xs font-semibold" style={{ color: '#0057b8' }}>Admin &amp; Instructor Portal</span>
      </motion.div>

      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="mb-8"
      >
        <h1
          className="mb-2 text-[32px] font-bold leading-tight tracking-tight text-white"
          style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
        >
          Welcome back
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>
          Sign in to your admin or instructor portal
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

        {/* Password */}
        <motion.div custom={1} variants={fieldVariant} initial="hidden" animate="visible">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Password
            </label>
            <Link href="/forgot-password" className="text-xs font-semibold transition-opacity hover:opacity-70"
              style={{ color: '#0057b8' }}>
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: errors.password ? '#EF4444' : 'rgba(255,255,255,0.3)' }} />
            <input
              {...register('password')}
              type={showPw ? 'text' : 'password'}
              placeholder="Enter your password"
              className="w-full rounded-xl py-3 pl-10 pr-11 text-sm text-white outline-none transition-all placeholder:text-white/25"
              style={{
                background: errors.password ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)',
                border: `1.5px solid ${errors.password ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`,
              }}
              onFocus={e => {
                e.currentTarget.style.border = '1.5px solid rgba(0,87,184,0.6)'
                e.currentTarget.style.background = 'rgba(255,255,255,0.09)'
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.12)'
              }}
              onBlur={e => {
                e.currentTarget.style.border = `1.5px solid ${errors.password ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`
                e.currentTarget.style.background = errors.password ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <AnimatePresence>
            {errors.password && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: '#EF4444' }}>
                <AlertCircle size={11} />{errors.password.message}
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
        <motion.div custom={2} variants={fieldVariant} initial="hidden" animate="visible">
          <motion.button type="submit" disabled={isSubmitting}
            whileHover={{ y: -2, boxShadow: '0 10px 32px rgba(0,87,184,0.42)' }}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 24px rgba(0,87,184,0.32)' }}>
            {isSubmitting
              ? <><Spinner size={16} />Signing in…</>
              : <>Sign in<ArrowRight size={16} /></>}
          </motion.button>
        </motion.div>
      </form>
    </div>
  )
}
