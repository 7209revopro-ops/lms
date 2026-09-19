'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, Smartphone, Monitor, Globe, X, AlertCircle,
  CheckCircle2, Trash2, UserX, Clock, LogOut, KeyRound, Copy, Check,
} from 'lucide-react'
import {
  useActiveSessions, useRevokeSession,
  deactivateAccount, deleteAccount,
  type ActiveSession,
} from '@/lib/api/user'
import { useTotpStatus, useTotpSetup, useTotpEnable, useTotpDisable } from '@/lib/api/totp'
import Spinner from '@/components/ui/Spinner'

function fmtRel(iso?: string): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)   return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function deviceLabel(ua?: string): { label: string; icon: typeof Smartphone } {
  if (!ua) return { label: 'Unknown device', icon: Monitor }
  if (/iPhone|iPad|iPod/.test(ua))    return { label: 'iOS device',     icon: Smartphone }
  if (/Android/.test(ua))             return { label: 'Android device', icon: Smartphone }
  if (/Mac OS X|Macintosh/.test(ua))  return { label: 'Mac',            icon: Monitor }
  if (/Windows/.test(ua))             return { label: 'Windows',        icon: Monitor }
  if (/Linux/.test(ua))               return { label: 'Linux',          icon: Monitor }
  return { label: 'Browser', icon: Monitor }
}

function browserLabel(ua?: string): string | null {
  if (!ua) return null
  if (/Edg\//.test(ua))            return 'Edge'
  if (/OPR\//.test(ua))            return 'Opera'
  if (/Chrome\//.test(ua))         return 'Chrome'
  if (/Firefox\//.test(ua))        return 'Firefox'
  if (/Safari\//.test(ua))         return 'Safari'
  return null
}

/* ── 2FA section ──────────────────────────────────── */
function TwoFactorSection() {
  const { data: statusData, isLoading: statusLoading } = useTotpStatus()
  const setup   = useTotpSetup()
  const enable  = useTotpEnable()
  const disable = useTotpDisable()

  const enabled = statusData?.enabled ?? false

  /* Setup flow state */
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [code,      setCode]      = useState('')
  const [disablePw, setDisablePw] = useState('')
  const [showDisable, setShowDisable] = useState(false)
  const [copied,    setCopied]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState<string | null>(null)
  /* Password gate in front of setup — enabling 2FA is as sensitive as
     disabling it, and disabling already asks (NEW-01). */
  const [showSetupPw, setShowSetupPw] = useState(false)
  const [setupPw,     setSetupPw]     = useState('')

  const handleSetup = async () => {
    if (!setupPw) return
    setError(null)
    try {
      const data = await setup.mutateAsync(setupPw)
      setSetupData(data)
      setSetupPw('')
      setShowSetupPw(false)
      setCode('')
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Setup failed.')
    }
  }

  const cancelSetupPw = () => {
    setShowSetupPw(false)
    setSetupPw('')
    setError(null)
  }

  const handleEnable = async () => {
    setError(null)
    try {
      await enable.mutateAsync(code)
      setSetupData(null)
      setCode('')
      setSuccess('Two-factor authentication enabled!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Invalid code.')
    }
  }

  const handleDisable = async () => {
    setError(null)
    try {
      await disable.mutateAsync(disablePw)
      setShowDisable(false)
      setDisablePw('')
      setSuccess('Two-factor authentication disabled.')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Could not disable 2FA.')
    }
  }

  const copySecret = () => {
    if (!setupData) return
    navigator.clipboard.writeText(setupData.secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
      <div className="mb-1 flex items-center gap-2">
        <KeyRound size={15} style={{ color: 'var(--color-primary)' }} />
        <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Two-factor authentication</h2>
        {!statusLoading && (
          <span className="ml-auto rounded-lg px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: enabled ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.08)',
              color:      enabled ? '#22C55E' : '#EF4444',
            }}>
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
        )}
      </div>
      <p className="mb-5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Add a second layer of security. Each login will require a 6-digit code from your authenticator app
        (Google Authenticator, Authy, 1Password, etc.).
      </p>

      <AnimatePresence mode="wait">
        {success && (
          <motion.div key="ok" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mb-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold"
            style={{ background: 'rgba(34,197,94,0.10)', color: 'var(--color-success)' }}>
            <CheckCircle2 size={13} />{success}
          </motion.div>
        )}
        {error && (
          <motion.div key="err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mb-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs"
            style={{ background: '#FEE2E2', color: 'var(--color-danger)' }}>
            <AlertCircle size={13} />{error}
          </motion.div>
        )}
      </AnimatePresence>

      {!enabled && !setupData && !showSetupPw && (
        <button onClick={() => { setError(null); setShowSetupPw(true) }}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all disabled:opacity-60 hover:opacity-90"
          style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.25)' }}>
          <KeyRound size={13} />Enable 2FA
        </button>
      )}

      {/* ── Confirm identity before issuing a secret ──
          Enabling a second factor decides how this account signs in from now
          on, so it asks for the password just as disabling does. */}
      <AnimatePresence>
        {!enabled && !setupData && showSetupPw && (
          <motion.div key="setup-pw" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Enter your password to confirm it&apos;s you before setting up 2FA.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={setupPw}
                  onChange={e => setSetupPw(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && setupPw && !setup.isPending) void handleSetup() }}
                  placeholder="Your password"
                  className="flex-1 min-w-[180px] rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                />
                <button onClick={handleSetup} disabled={setup.isPending || !setupPw}
                  className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all disabled:opacity-60 hover:opacity-90"
                  style={{ background: 'var(--color-primary)' }}>
                  {setup.isPending ? <><Spinner size={13} />Setting up…</> : <>Continue</>}
                </button>
                <button onClick={cancelSetupPw} disabled={setup.isPending}
                  className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--color-bg-muted)] disabled:opacity-60"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Setup flow ── */}
      <AnimatePresence>
        {setupData && (
          <motion.div key="setup" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden space-y-4">

            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-primary-light)', border: '1px solid rgba(0,87,184,0.18)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                Step 1: Open your authenticator app and scan the QR code, or enter the key manually.
              </p>

              {/* otpauth link — mobile users can tap this to open their authenticator directly */}
              <a href={setupData.otpauthUrl}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors hover:bg-orange-100"
                style={{ background: 'rgba(0,87,184,0.08)', color: 'var(--color-primary)', border: '1px solid rgba(0,87,184,0.2)' }}>
                <KeyRound size={12} />Tap here to open in authenticator app (mobile)
              </a>

              {/* Secret for manual entry */}
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                  Or enter this key manually
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 select-all rounded-lg px-3 py-2 text-xs font-mono tracking-widest"
                    style={{ background: 'var(--color-bg-page)', color: 'var(--color-text-primary)', letterSpacing: '0.2em' }}>
                    {setupData.secret.match(/.{1,4}/g)?.join(' ')}
                  </code>
                  <button onClick={copySecret}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
                    style={{ color: copied ? '#22C55E' : 'var(--color-text-muted)' }}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                Step 2: Enter the 6-digit code your app shows now
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000 000"
                  maxLength={6}
                  className="w-36 rounded-xl px-3 py-2.5 text-center text-base font-mono tracking-[0.3em] outline-none"
                  style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                  onFocus={e => { e.currentTarget.style.border = '1.5px solid #0057b8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)' }}
                  onBlur={e => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
                  onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) handleEnable() }}
                />
                <button onClick={handleEnable} disabled={code.length !== 6 || enable.isPending}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all disabled:opacity-50"
                  style={{ background: 'var(--color-success)' }}>
                  {enable.isPending ? <><Spinner size={13} />Verifying…</> : <><CheckCircle2 size={13} />Verify & enable</>}
                </button>
                <button onClick={() => { setSetupData(null); setCode(''); setError(null) }}
                  className="rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
                  style={{ color: 'var(--color-text-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Disable flow ── */}
      {enabled && !showDisable && (
        <button onClick={() => { setShowDisable(true); setError(null) }}
          className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--color-hover-danger)]"
          style={{ color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.20)' }}>
          Disable 2FA
        </button>
      )}
      <AnimatePresence>
        {showDisable && (
          <motion.div key="disable" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden space-y-3">
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Enter your password to confirm disabling 2FA.</p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={disablePw}
                onChange={e => setDisablePw(e.target.value)}
                placeholder="Your password"
                className="w-48 rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                onFocus={e => { e.currentTarget.style.border = '1.5px solid #EF4444' }}
                onBlur={e => { e.currentTarget.style.border = '1px solid var(--color-border)' }}
                onKeyDown={e => { if (e.key === 'Enter' && disablePw) handleDisable() }}
              />
              <button onClick={handleDisable} disabled={!disablePw || disable.isPending}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'var(--color-danger)' }}>
                {disable.isPending ? <Spinner size={13} /> : null}
                Disable
              </button>
              <button onClick={() => { setShowDisable(false); setDisablePw(''); setError(null) }}
                className="rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
                style={{ color: 'var(--color-text-muted)' }}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PrivacySecuritySection() {
  const { data: sessions, isLoading } = useActiveSessions()
  const revoke = useRevokeSession()

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-5">

      {/* ── Active sessions ─────────────────────────── */}
      <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
        <div className="mb-1 flex items-center gap-2">
          <Shield size={15} style={{ color: 'var(--color-primary)' }} />
          <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Active sessions</h2>
        </div>
        <p className="mb-5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Devices and browsers currently signed into your account. Sign out anywhere you don&apos;t recognise.
        </p>

        {isLoading && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <Spinner size={12} />Loading sessions…
          </div>
        )}

        <div className="space-y-2">
          {sessions?.map(s => (
            <SessionRow key={s.id} session={s} onRevoke={() => revoke.mutateAsync(s.id)} revoking={revoke.isPending} />
          ))}
        </div>
        {sessions && sessions.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No active sessions.</p>
        )}
      </div>

      {/* ── 2FA ─────────────────────────────────────── */}
      <TwoFactorSection />

      {/* ── Danger zone ─────────────────────────────── */}
      <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid rgba(239,68,68,0.18)' }}>
        <div className="mb-1 flex items-center gap-2">
          <AlertCircle size={15} style={{ color: 'var(--color-danger)' }} />
          <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Danger zone</h2>
        </div>
        <p className="mb-5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          These actions sign you out immediately. Read the descriptions carefully.
        </p>

        <DangerCard
          icon={UserX}
          title="Deactivate account"
          desc="You'll be signed out of all devices and won't be able to sign back in. An admin can reactivate the account later. Your courses, reviews, and progress are kept."
          confirmLabel="Deactivate"
          confirmTitle="Deactivate this account?"
          confirmHint="Type your current password to confirm."
          severity="warning"
          run={deactivateAccount}
          afterSuccess="Account deactivated. Redirecting you out…"
          requireTyping={null} />

        <div className="my-4 h-px" style={{ background: 'var(--color-bg-subtle)' }} />

        <DangerCard
          icon={Trash2}
          title="Delete account permanently"
          desc="Removes your account, enrolments, lesson progress, reviews, and active sessions. This cannot be undone. Your email will be free to register again."
          confirmLabel="Permanently delete"
          confirmTitle="Permanently delete your account?"
          confirmHint='Type "delete my account" exactly, then enter your password.'
          severity="danger"
          run={deleteAccount}
          afterSuccess="Account deleted. Goodbye."
          requireTyping="delete my account" />
      </div>
    </motion.div>
  )
}

function SessionRow({ session, onRevoke, revoking }: {
  session: ActiveSession
  onRevoke: () => Promise<unknown>
  revoking: boolean
}) {
  const { label, icon: Icon } = deviceLabel(session.userAgent)
  const browser = browserLabel(session.userAgent)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="flex items-center gap-3 rounded-xl p-3"
      style={{ border: `1px solid ${session.isCurrent ? 'rgba(34,197,94,0.30)' : 'var(--color-border)'}` }}>
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: session.isCurrent ? 'rgba(34,197,94,0.10)' : 'var(--color-bg-page)' }}>
        <Icon size={14} style={{ color: session.isCurrent ? '#22C55E' : 'var(--color-text-muted)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {label}{browser ? ` · ${browser}` : ''}
          </p>
          {session.isCurrent && (
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(34,197,94,0.10)', color: 'var(--color-success)' }}>
              This device
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {session.ip && <span className="flex items-center gap-1"><Globe size={9} />{session.ip}</span>}
          <span className="flex items-center gap-1"><Clock size={9} />Active {fmtRel(session.lastUsedAt ?? session.createdAt)}</span>
        </div>
      </div>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} disabled={revoking}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-hover-danger)]"
          style={{ color: session.isCurrent ? 'var(--color-text-muted)' : '#EF4444' }}>
          <LogOut size={11} />{session.isCurrent ? 'Sign out' : 'Revoke'}
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <button onClick={() => setConfirming(false)}
            className="rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
            style={{ color: 'var(--color-text-muted)' }}>Cancel</button>
          <button onClick={async () => { await onRevoke(); setConfirming(false) }}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-white"
            style={{ background: 'var(--color-danger)' }}>
            {revoking ? <Spinner size={10} /> : <CheckCircle2 size={10} />}
            Confirm
          </button>
        </div>
      )}
    </div>
  )
}

interface DangerCardProps {
  icon:            React.ElementType
  title:           string
  desc:            string
  confirmLabel:    string
  confirmTitle:    string
  confirmHint:     string
  severity:        'warning' | 'danger'
  run:             (password: string) => Promise<void>
  afterSuccess:    string
  requireTyping:   string | null  // user must type this exact phrase, or null to skip
}

function DangerCard(p: DangerCardProps) {
  const Icon = p.icon
  const [open,     setOpen]     = useState(false)
  const [password, setPassword] = useState('')
  const [typed,    setTyped]    = useState('')
  const [pending,  setPending]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [done,     setDone]     = useState(false)

  const palette = p.severity === 'danger'
    ? { bg: '#EF4444', soft: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.25)' }
    : { bg: '#F59E0B', soft: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)' }

  const typedOk = p.requireTyping === null || typed.trim() === p.requireTyping

  const submit = async () => {
    if (!password || !typedOk) return
    setPending(true)
    setError(null)
    try {
      await p.run(password)
      setDone(true)
      setTimeout(() => { window.location.href = '/login' }, 1400)
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message
      setError(msg ?? 'Could not complete this action.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: palette.soft, border: `1px solid ${palette.border}` }}>
          <Icon size={14} style={{ color: palette.bg }} />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{p.title}</p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{p.desc}</p>
        </div>
      </div>
      <button onClick={() => setOpen(true)}
        className="flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors hover:bg-[var(--color-hover-danger)]"
        style={{ color: palette.bg, border: `1px solid ${palette.border}` }}>
        {p.confirmLabel}
      </button>

      {/* Two keyed children rather than one fragment: AnimatePresence tracks
          direct children by key, so a fragment hides them from it and their
          exit animations never run. */}
      <AnimatePresence>
        {open && (
            <motion.div
              key="confirm-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !pending && !done && setOpen(false)}
              className="fixed inset-0 z-50"
              style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} />
        )}
        {open && (
            <motion.div
              key="confirm-dialog"
              initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              /* max-h + scroll, because this dialog asks you to TYPE. Centred
                 with -translate-y-1/2 and no height cap, the phrase field, the
                 password field and the confirm button sat under the iOS
                 keyboard with no way to reach them - on the one dialog in the
                 app that deletes an account. 90dvh is the visible viewport,
                 not the toolbar-retracted one. */
              className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-3xl bg-[var(--color-bg-surface)] p-6"
              style={{ boxShadow: '0 30px 80px rgba(13,15,26,0.18)' }}>
              <button onClick={() => !pending && !done && setOpen(false)}
                className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bg-muted)]"
                style={{ color: 'var(--color-text-muted)' }}>
                <X size={14} />
              </button>

              {done ? (
                <div className="flex flex-col items-center gap-3 py-2 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-3xl"
                    style={{ background: 'rgba(16,185,129,0.10)' }}>
                    <CheckCircle2 size={22} style={{ color: 'var(--color-success)' }} />
                  </div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{p.afterSuccess}</p>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl"
                      style={{ background: palette.soft, border: `1px solid ${palette.border}` }}>
                      <Icon size={15} style={{ color: palette.bg }} />
                    </div>
                    <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>{p.confirmTitle}</h3>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{p.confirmHint}</p>

                  {p.requireTyping !== null && (
                    <div className="mt-4">
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                        Confirmation
                      </label>
                      <input
                        value={typed}
                        onChange={e => setTyped(e.target.value)}
                        placeholder={p.requireTyping}
                        className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                        style={{ background: 'var(--color-bg-page)', border: '1.5px solid transparent', color: 'var(--color-text-primary)' }}
                        onFocus={e => { e.currentTarget.style.border = '1.5px solid #EF4444'; e.currentTarget.style.background = '#FFFFFF' }}
                        onBlur={e => { e.currentTarget.style.border = '1.5px solid transparent'; e.currentTarget.style.background = 'var(--color-bg-page)' }} />
                    </div>
                  )}

                  <div className="mt-3">
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                      Current password
                    </label>
                    <input
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                      style={{ background: 'var(--color-bg-page)', border: '1.5px solid transparent', color: 'var(--color-text-primary)' }}
                      onFocus={e => { e.currentTarget.style.border = '1.5px solid #2F6BFF'; e.currentTarget.style.background = '#FFFFFF' }}
                      onBlur={e => { e.currentTarget.style.border = '1.5px solid transparent'; e.currentTarget.style.background = 'var(--color-bg-page)' }} />
                  </div>

                  {error && (
                    <p className="mt-2 flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                      <AlertCircle size={11} />{error}
                    </p>
                  )}

                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button onClick={() => setOpen(false)} disabled={pending}
                      className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
                      style={{ color: 'var(--color-text-muted)' }}>
                      Cancel
                    </button>
                    <button onClick={submit} disabled={pending || !password || !typedOk}
                      className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-50"
                      style={{ background: palette.bg }}>
                      {pending
                        ? <><Spinner size={13} />Working…</>
                        : p.confirmLabel}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
