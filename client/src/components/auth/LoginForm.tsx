'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Mail, Lock, ArrowRight, ArrowLeft, AlertCircle, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

/* ─── Validation schema ─────────────────────────── */
const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  remember: z.boolean().optional(),
})
type LoginValues = z.infer<typeof loginSchema>

/* ─── Field animation ───────────────────────────── */
const fieldVariant = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24, delay: i * 0.06 },
  }),
}

/* ─── Safe post-login redirect ──────────────────── */
function safeRedirect(raw: string | null): string {
  if (!raw) return '/my-learning'
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return '/my-learning'
    return url.pathname.replace(/^\/+/, '/') + url.search + url.hash
  } catch {
    return '/my-learning'
  }
}

interface LoginFormProps {
  onSwitch: () => void
}

export function LoginForm({ onSwitch }: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [serverError,  setServerError]  = useState<string | null>(null)
  /* The error CODE, kept beside the message.

     An account with no password cannot be talked out of the problem — it needs
     an action, and the action is a reset link. Knowing which refusal this was
     is what lets the box below carry a button instead of a sentence. */
  const [serverErrorCode, setServerErrorCode] = useState<string | null>(null)
  const [resetSent,       setResetSent]       = useState(false)
  const [sendingReset,    setSendingReset]    = useState(false)
  /* 2FA challenge step — set when the backend answers with twoFactorRequired */
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [code,           setCode]           = useState('')
  const [verifying,      setVerifying]      = useState(false)
  /* Passwordless (email → OTP) login — separate flow from the password form. */
  const [otpStep,  setOtpStep]  = useState<null | 'email' | 'code'>(null)
  const [otpEmail, setOtpEmail] = useState('')
  const [otpCode,  setOtpCode]  = useState('')
  const [otpBusy,  setOtpBusy]  = useState(false)

  /* Deep link: /login?method=email opens the passwordless step directly, so
     the "No password needed" flow has its own reachable URL. */
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('method') === 'email') {
        setOtpStep('email')
      }
    } catch { /* SSR / no window — ignore */ }
  }, [])

  const {
    register,
    handleSubmit,
    /* Read back the typed address so the reset link can be sent to it without
       asking the student to type it a second time. */
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { remember: false },
  })

  /* ─── Post-login handling (shared by password + 2FA paths) ── */
  const completeLogin = async (role?: string) => {
    // Backend sets httpOnly lms_at + lms_rt cookies on success.
    // Block admin/instructor accounts — they should use the admin panel.
    if (role === 'admin' || role === 'instructor') {
      // Clear the cookie we just set
      await api.post('/auth/logout').catch(() => {})
      setChallengeToken(null)
      setServerError('This is the student portal. Please sign in at the admin panel instead.')
      return
    }
    // Clear any leftover cart from a previous user session before navigating
    localStorage.removeItem('lms-cart')
    const from = new URLSearchParams(window.location.search).get('from')
    window.location.href = safeRedirect(from)
  }

  /* ─── Submit handler ──────────────────────────── */
  const onSubmit = async (data: LoginValues) => {
    setServerError(null)
    setServerErrorCode(null)
    try {
      const res = await api.post<{
        success: true
        data: { user?: { role: string }; twoFactorRequired?: boolean; challengeToken?: string }
      }>('/auth/login', { email: data.email, password: data.password })

      // 2FA accounts get a short-lived challenge instead of a session.
      const payload = res.data?.data
      if (payload?.twoFactorRequired) {
        if (!payload.challengeToken) {
          setServerError('Unable to start two-factor verification. Please try again.')
          return
        }
        setCode('')
        setChallengeToken(payload.challengeToken)
        return
      }

      await completeLogin(payload?.user?.role)
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message
      setServerError(msg ?? 'Unable to sign in. Please try again.')
      setServerErrorCode(err?.response?.data?.error?.code ?? null)
    }
  }

  /* Sends the student the link that actually fixes their account.

     Deliberately reuses forgot-password rather than anything new: it issues a
     reset token for any active account whether or not a password hash exists,
     and reset writes one — so it is already the right mechanism for an import
     or an external purchase that never set one. */
  const sendSetPasswordLink = async (): Promise<void> => {
    const email = (getValues('email') ?? '').trim()
    if (!email) return
    setSendingReset(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setResetSent(true)
    } catch {
      /* forgot-password answers 200 whether or not the account exists, so a
         failure here is the network rather than the address. */
      setServerError('Could not send the link just now. Please try again in a moment.')
    } finally {
      setSendingReset(false)
    }
  }

  /* ─── 2FA verification handler ────────────────── */
  const onVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!challengeToken || verifying) return
    if (!/^\d{6}$/.test(code)) {
      setServerError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setServerError(null)
    setVerifying(true)
    try {
      const res = await api.post<{ success: true; data: { user?: { role: string } } }>(
        '/auth/login/2fa',
        { challengeToken, code },
      )
      await completeLogin(res.data?.data?.user?.role)
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message
      setServerError(msg ?? 'That code was not accepted. Please try again.')
      setCode('')
    } finally {
      setVerifying(false)
    }
  }

  /* ─── Back to the credentials step ────────────── */
  const cancelChallenge = () => {
    setChallengeToken(null)
    setCode('')
    setServerError(null)
  }

  /* ─── Passwordless: request a code ────────────── */
  const requestOtp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (otpBusy) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(otpEmail.trim())) {
      setServerError('Enter a valid email address.')
      return
    }
    setServerError(null)
    setOtpBusy(true)
    try {
      await api.post('/auth/otp/request', { email: otpEmail.trim() })
      setOtpCode('')
      setOtpStep('code')
    } catch (err: any) {
      setServerError(err?.response?.data?.error?.message ?? 'Could not send a code. Please try again.')
    } finally {
      setOtpBusy(false)
    }
  }

  /* ─── Passwordless: verify the code ───────────── */
  const verifyOtp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (otpBusy) return
    if (!/^\d{6}$/.test(otpCode)) {
      setServerError('Enter the 6-digit code from your email.')
      return
    }
    setServerError(null)
    setOtpBusy(true)
    try {
      const res = await api.post<{ success: true; data: { user?: { role: string } } }>(
        '/auth/otp/verify',
        { email: otpEmail.trim(), code: otpCode },
      )
      await completeLogin(res.data?.data?.user?.role)
    } catch (err: any) {
      setServerError(err?.response?.data?.error?.message ?? 'That code was not accepted. Please try again.')
      setOtpCode('')
    } finally {
      setOtpBusy(false)
    }
  }

  const exitOtp = () => { setOtpStep(null); setOtpCode(''); setServerError(null) }

  /* ─── Passwordless (email → OTP) step ─────────── */
  if (otpStep) {
    const onEmail = otpStep === 'email'
    return (
      <motion.div
        key="login-otp"
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -40 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="w-full"
      >
        <div className="mb-8">
          <p className="mb-1 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            {onEmail ? 'Sign in with email ✉️' : 'Check your inbox 📩'}
          </p>
          <h2
            className="text-[28px] font-bold leading-tight tracking-tight"
            style={{ fontFamily: 'var(--font-display), sans-serif', color: 'var(--color-text-primary)' }}
          >
            {onEmail ? 'No password needed' : 'Enter your code'}
          </h2>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {onEmail
              ? 'We’ll email you a six-digit code to sign in.'
              : <>We sent a code to <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{otpEmail}</span>.</>}
          </p>
        </div>

        <form onSubmit={onEmail ? requestOtp : verifyOtp} noValidate className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {onEmail ? 'Email address' : 'Six-digit code'}
            </label>
            <div className="relative">
              {onEmail
                ? <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
                : <ShieldCheck size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />}
              {onEmail ? (
                <input
                  value={otpEmail}
                  onChange={e => setOtpEmail(e.target.value)}
                  type="email" autoComplete="email" autoFocus placeholder="you@example.com"
                  className="w-full rounded-xl py-3 pl-10 pr-4 text-sm outline-none transition-all"
                  style={{ background: 'var(--color-bg-surface)', border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'DM Sans, sans-serif' }}
                  onFocus={e => { e.currentTarget.style.border = '1.5px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)' }}
                  onBlur={e => { e.currentTarget.style.border = '1.5px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
                />
              ) : (
                <input
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="000000"
                  className="w-full rounded-xl py-3 pl-10 pr-4 text-sm tracking-[0.4em] outline-none transition-all"
                  style={{ background: 'var(--color-bg-surface)', border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'DM Sans, sans-serif' }}
                  onFocus={e => { e.currentTarget.style.border = '1.5px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)' }}
                  onBlur={e => { e.currentTarget.style.border = '1.5px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
                />
              )}
            </div>
          </div>

          <AnimatePresence>
            {serverError && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm"
                style={{ background: '#FEE2E2', color: 'var(--color-danger)' }}
              >
                <AlertCircle size={15} />{serverError}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            type="submit" disabled={otpBusy}
            whileHover={{ y: -2, boxShadow: '0 8px 28px rgba(0,87,184,0.35)' }} whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: 'var(--color-primary)', boxShadow: '0 4px 20px rgba(0,87,184,0.30)' }}
          >
            {otpBusy ? <><Spinner size={16} />{onEmail ? 'Sending…' : 'Verifying…'}</> : <>{onEmail ? 'Send code' : 'Verify & sign in'}<ArrowRight size={16} /></>}
          </motion.button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <button type="button" onClick={onEmail ? exitOtp : () => { setOtpStep('email'); setServerError(null) }}
            className="inline-flex items-center gap-1 font-semibold transition-opacity hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
            <ArrowLeft size={14} />{onEmail ? 'Use a password' : 'Change email'}
          </button>
          {!onEmail && (
            <button type="button" disabled={otpBusy}
              onClick={() => requestOtp({ preventDefault() {} } as FormEvent<HTMLFormElement>)}
              className="font-semibold transition-opacity hover:opacity-70 disabled:opacity-50" style={{ color: 'var(--color-primary)' }}>
              Resend code
            </button>
          )}
        </div>
      </motion.div>
    )
  }

  /* ─── 2FA challenge step ──────────────────────── */
  if (challengeToken) {
    return (
      <motion.div
        key="login-2fa"
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -40 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="w-full"
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-8"
        >
          <p className="mb-1 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            One more step 🔐
          </p>
          <h2
            className="text-[28px] font-bold leading-tight tracking-tight"
            style={{ fontFamily: 'var(--font-display), sans-serif', color: 'var(--color-text-primary)' }}
          >
            Two-factor verification
          </h2>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Enter the 6-digit code from your authenticator app.
          </p>
        </motion.div>

        <form onSubmit={onVerify} noValidate className="space-y-4">
          {/* Code */}
          <motion.div custom={2} variants={fieldVariant} initial="hidden" animate="visible">
            <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Authentication code
            </label>
            <div className="relative">
              <ShieldCheck
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2"
                style={{ color: serverError ? '#EF4444' : 'var(--color-text-muted)' }}
              />
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                placeholder="000000"
                className="w-full rounded-xl py-3 pl-10 pr-4 text-sm tracking-[0.4em] outline-none transition-all"
                style={{
                  background: serverError ? '#FEF2F2' : 'var(--color-bg-page)',
                  border: `1.5px solid ${serverError ? '#FCA5A5' : 'transparent'}`,
                  color: 'var(--color-text-primary)',
                  fontFamily: 'DM Sans, sans-serif',
                }}
                onFocus={e => {
                  e.currentTarget.style.border = `1.5px solid ${serverError ? '#EF4444' : 'transparent'}`
                  e.currentTarget.style.background = '#FFFFFF'
                  e.currentTarget.style.boxShadow = serverError
                    ? '0 0 0 3px rgba(239,68,68,0.12)'
                    : '0 0 0 3px rgba(0,87,184,0.12)'
                }}
                onBlur={e => {
                  e.currentTarget.style.border = `1.5px solid ${serverError ? '#FCA5A5' : 'transparent'}`
                  e.currentTarget.style.background = serverError ? '#FEF2F2' : 'var(--color-bg-page)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            </div>
          </motion.div>

          {/* Server error */}
          <AnimatePresence>
            {serverError && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm"
                style={{ background: '#FEE2E2', color: 'var(--color-danger)' }}
              >
                <AlertCircle size={15} />
                {serverError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <motion.div custom={3} variants={fieldVariant} initial="hidden" animate="visible">
            <motion.button
              type="submit"
              disabled={verifying}
              whileHover={{ y: -2, boxShadow: '0 8px 28px rgba(0,87,184,0.35)' }}
              whileTap={{ scale: 0.98 }}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: 'var(--color-primary)',
                boxShadow: '0 4px 20px rgba(0,87,184,0.30)',
              }}
            >
              {verifying ? (
                <>
                  <Spinner size={16} />
                  Verifying…
                </>
              ) : (
                <>
                  Verify code
                  <ArrowRight size={16} />
                </>
              )}
            </motion.button>
          </motion.div>
        </form>

        {/* Back to sign in */}
        <motion.p
          custom={4}
          variants={fieldVariant}
          initial="hidden"
          animate="visible"
          className="mt-6 text-center text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <button
            type="button"
            onClick={cancelChallenge}
            className="inline-flex items-center gap-1 font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-primary)' }}
          >
            <ArrowLeft size={14} />
            Back to sign in
          </button>
        </motion.p>
      </motion.div>
    )
  }

  return (
    <motion.div
      key="login"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className="w-full"
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mb-8"
      >
        <p className="mb-1 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Welcome back 👋
        </p>
        <h2
          className="text-[28px] font-bold leading-tight tracking-tight"
          style={{ fontFamily: 'var(--font-display), sans-serif', color: 'var(--color-text-primary)' }}
        >
          Sign in to your account
        </h2>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Pick up right where you left off.
        </p>
      </motion.div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {/* Email */}
        <motion.div custom={2} variants={fieldVariant} initial="hidden" animate="visible">
          <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Email address
          </label>
          <div className="relative">
            <Mail
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: errors.email ? '#EF4444' : 'var(--color-text-muted)' }}
            />
            <input
              {...register('email')}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-xl py-3 pl-10 pr-4 text-sm outline-none transition-all"
              style={{
                background: errors.email ? '#FEF2F2' : 'var(--color-bg-surface)',
                border: `1.5px solid ${errors.email ? '#FCA5A5' : 'var(--color-border)'}`,
                color: 'var(--color-text-primary)',
                fontFamily: 'DM Sans, sans-serif',
              }}
              onFocus={e => {
                e.currentTarget.style.border = `1.5px solid ${errors.email ? '#EF4444' : '#3B82F6'}`
                e.currentTarget.style.boxShadow = errors.email
                  ? '0 0 0 3px rgba(239,68,68,0.12)'
                  : '0 0 0 3px rgba(59,130,246,0.12)'
              }}
              onBlur={e => {
                e.currentTarget.style.border = `1.5px solid ${errors.email ? '#FCA5A5' : 'var(--color-border)'}`
                e.currentTarget.style.background = errors.email ? '#FEF2F2' : 'var(--color-bg-surface)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>
          <AnimatePresence>
            {errors.email && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-1.5 flex items-center gap-1 text-xs"
                style={{ color: 'var(--color-danger)' }}
              >
                <AlertCircle size={11} />
                {errors.email.message}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Password */}
        <motion.div custom={3} variants={fieldVariant} initial="hidden" animate="visible">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Password
            </label>
            <a
              href="/forgot-password"
              className="text-xs font-medium transition-colors hover:opacity-70"
              style={{ color: 'var(--color-primary)' }}
            >
              Forgot password?
            </a>
          </div>
          <div className="relative">
            <Lock
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: errors.password ? '#EF4444' : 'var(--color-text-muted)' }}
            />
            <input
              {...register('password')}
              type={showPassword ? 'text' : 'password'}
              placeholder="Min. 6 characters"
              autoComplete="current-password"
              className="w-full rounded-xl py-3 pl-10 pr-11 text-sm outline-none transition-all"
              style={{
                background: errors.password ? '#FEF2F2' : 'var(--color-bg-surface)',
                border: `1.5px solid ${errors.password ? '#FCA5A5' : 'var(--color-border)'}`,
                color: 'var(--color-text-primary)',
                fontFamily: 'DM Sans, sans-serif',
              }}
              onFocus={e => {
                e.currentTarget.style.border = `1.5px solid ${errors.password ? '#EF4444' : '#3B82F6'}`
                e.currentTarget.style.boxShadow = errors.password
                  ? '0 0 0 3px rgba(239,68,68,0.12)'
                  : '0 0 0 3px rgba(59,130,246,0.12)'
              }}
              onBlur={e => {
                e.currentTarget.style.border = `1.5px solid ${errors.password ? '#FCA5A5' : 'var(--color-border)'}`
                e.currentTarget.style.background = errors.password ? '#FEF2F2' : 'var(--color-bg-surface)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <AnimatePresence>
            {errors.password && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-1.5 flex items-center gap-1 text-xs"
                style={{ color: 'var(--color-danger)' }}
              >
                <AlertCircle size={11} />
                {errors.password.message}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Remember me */}
        <motion.div
          custom={4}
          variants={fieldVariant}
          initial="hidden"
          animate="visible"
          className="flex items-center gap-2"
        >
          <input
            {...register('remember')}
            type="checkbox"
            id="remember"
            className="h-4 w-4 cursor-pointer rounded"
            style={{ accentColor: '#0057b8' }}
          />
          <label htmlFor="remember" className="cursor-pointer text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Remember me for 30 days
          </label>
        </motion.div>

        {/* Server error */}
        <AnimatePresence>
          {serverError && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex flex-col gap-2.5 rounded-xl px-4 py-3 text-sm"
              style={{ background: '#FEE2E2', color: 'var(--color-danger)' }}
            >
              <span className="flex items-center gap-2.5">
                <AlertCircle size={15} className="flex-shrink-0" />
                {serverError}
              </span>

              {/* An account with no password cannot act on a sentence.

                  These are bulk-imported students and external-purchase
                  buyers whose welcome link was never opened or has expired —
                  they are not social logins, and there is no Google sign-in
                  to send them to. One button, doing the thing that works. */}
              {serverErrorCode === 'NO_PASSWORD_SET' && (
                resetSent ? (
                  <span className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]"
                    style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#047857' }}>
                    <Mail size={14} className="flex-shrink-0" />
                    Check your inbox — we sent a link to set your password.
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={sendSetPasswordLink}
                    disabled={sendingReset}
                    className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-bold text-white transition-opacity disabled:opacity-60"
                    style={{ background: 'var(--color-primary)' }}>
                    {sendingReset
                      ? <><Spinner size={13} />Sending…</>
                      : <><Mail size={14} />Email me a link to set my password</>}
                  </button>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit */}
        <motion.div custom={5} variants={fieldVariant} initial="hidden" animate="visible">
          <motion.button
            type="submit"
            disabled={isSubmitting}
            whileHover={{ y: -2, boxShadow: '0 8px 28px rgba(0,87,184,0.35)' }}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: 'var(--color-primary)',
              boxShadow: '0 4px 20px rgba(0,87,184,0.30)',
            }}
          >
            {isSubmitting ? (
              <>
                <Spinner size={16} />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRight size={16} />
              </>
            )}
          </motion.button>
        </motion.div>
      </form>

      {/* Passwordless option */}
      <motion.div custom={6} variants={fieldVariant} initial="hidden" animate="visible" className="mt-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>or</span>
          <div className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
        </div>
        <button
          type="button"
          onClick={() => { setServerError(null); setOtpStep('email') }}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all hover:opacity-80"
          style={{ background: 'var(--color-bg-page)', color: 'var(--color-text-primary)', border: '1.5px solid var(--color-border)' }}
        >
          <Mail size={16} />
          Sign in with email code
        </button>
      </motion.div>

      {/* Switch to register */}
      <motion.p
        custom={6}
        variants={fieldVariant}
        initial="hidden"
        animate="visible"
        className="mt-6 text-center text-sm"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onSwitch}
          className="font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-primary)' }}
        >
          Create one free →
        </button>
      </motion.p>
    </motion.div>
  )
}

