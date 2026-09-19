'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Bell, Shield, CreditCard, Globe,
  Camera, Check, LogOut, LayoutDashboard,
  PanelLeft, AlignJustify, Monitor, AlertCircle, Lock, Eye, EyeOff, FileText, Mail,
  Receipt, ArrowRight,} from 'lucide-react'
import { useUIStore } from '@/store/ui.store'
import {
  useCurrentUser, useUpdateProfile, useChangePassword,
  useRequestEmailChange, useCancelEmailChange, logout as apiLogout,
} from '@/lib/api/user'
import { PrivacySecuritySection } from '@/components/auth/PrivacySecuritySection'
import { RequestSection } from '@/components/settings/RequestSection'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
const fadeUp  = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } } }

const BASE_MENU = [
  { id: 'profile',       icon: User,            label: 'Profile'               },
  { id: 'layout',        icon: LayoutDashboard, label: 'Layout & Navigation'   },
  { id: 'notifications', icon: Bell,            label: 'Notifications'         },
  { id: 'privacy',       icon: Shield,          label: 'Privacy & Security'    },
  { id: 'billing',       icon: CreditCard,      label: 'Billing'               },
  { id: 'language',      icon: Globe,           label: 'Language & Region'     },
]

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <motion.button onClick={onToggle}
      className="relative flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors"
      style={{ background: on ? '#0057b8' : 'var(--color-text-muted)' }}>
      <motion.span animate={{ x: on ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        className="absolute h-4 w-4 rounded-full bg-[var(--color-bg-surface)] shadow-sm" />
    </motion.button>
  )
}

function LayoutCard({
  value, label, desc, selected, onSelect, preview,
}: {
  value: string; label: string; desc: string; selected: boolean; onSelect: () => void
  preview: React.ReactNode
}) {
  return (
    <motion.button whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      className="relative flex flex-col overflow-hidden rounded-2xl text-left w-full transition-all"
      style={{
        border: selected ? '2px solid #0057b8' : '2px solid var(--color-border)',
        boxShadow: selected ? '0 0 0 3px rgba(0,87,184,0.12)' : '0 2px 6px rgba(0,0,0,0.04)',
      }}>
      <div className="h-36 w-full" style={{ background: 'var(--color-bg-page)' }}>{preview}</div>
      <div className="flex items-start justify-between p-4">
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>{label}</p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>{desc}</p>
        </div>
        <div className="mt-0.5 ml-2 flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors"
          style={{ borderColor: selected ? '#0057b8' : 'var(--color-text-muted)', background: selected ? '#0057b8' : 'transparent' }}>
          {selected && <Check size={11} color="white" strokeWidth={3} />}
        </div>
      </div>
    </motion.button>
  )
}

function SidebarPreview() {
  return (
    <div className="flex h-full w-full gap-2 p-3">
      <div className="flex w-14 flex-shrink-0 flex-col gap-1.5 rounded-xl p-2"
        style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
        <div className="h-4 w-4 rounded-lg" style={{ background: 'var(--color-primary)' }} />
        {[0,1,2].map(i => (
          <div key={i} className="h-2 rounded-full"
            style={{ background: i === 0 ? 'rgba(0,87,184,0.2)' : 'var(--color-bg-subtle)', width: i === 0 ? '100%' : '80%' }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between rounded-xl px-2 py-1.5"
          style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
          <div className="h-2 w-16 rounded-full" style={{ background: 'var(--color-bg-subtle)' }} />
          <div className="h-4 w-4 rounded-full" style={{ background: 'var(--color-primary)' }} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <div className="h-2 w-3/4 rounded-full" style={{ background: 'var(--color-border)' }} />
          <div className="flex flex-1 gap-1 mt-0.5">
            {[0,1].map(i => <div key={i} className="flex-1 rounded-xl" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

function TopbarPreview() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-3">
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-4 rounded-lg" style={{ background: 'var(--color-primary)' }} />
            <div className="h-2 w-12 rounded-full" style={{ background: 'var(--color-bg-subtle)' }} />
          </div>
          <div className="flex gap-1">
            <div className="h-4 w-10 rounded-lg" style={{ background: 'var(--color-primary)' }} />
            <div className="h-4 w-4 rounded-full" style={{ background: 'var(--color-bg-subtle)' }} />
          </div>
        </div>
        <div className="flex items-end gap-1 px-3 py-1">
          {['My Learning','Catalog','Favorites'].map((t, i) => (
            <div key={t} className="relative px-2 py-1">
              <div className="h-1.5 rounded-full"
                style={{ background: i === 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)', width: i === 0 ? 40 : 28 }} />
              {i === 0 && <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: 'var(--color-primary)' }} />}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <div className="h-2 w-3/4 rounded-full" style={{ background: 'var(--color-border)' }} />
        <div className="flex gap-1.5 flex-1 mt-0.5">
          {[0,1,2].map(i => <div key={i} className="flex-1 rounded-xl" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }} />)}
        </div>
      </div>
    </div>
  )
}

export default function SettingsContent() {
  const router        = useRouter()
  const { navLayout, setNavLayout } = useUIStore()

  /* active tab driven by URL ?tab=xxx, defaults to "profile".
     Safe to read window here — this file is never server-rendered (ssr:false). */
  const [active, setActiveState] = useState(() =>
    new URLSearchParams(window.location.search).get('tab') ?? 'profile'
  )

  /* Keep in sync when using browser back/forward */
  useEffect(() => {
    const handlePop = () => {
      setActiveState(new URLSearchParams(window.location.search).get('tab') ?? 'profile')
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  const setActive = (id: string) => {
    setActiveState(id)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', id)
    window.history.pushState({}, '', url.toString())
  }

  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [notifs,  setNotifs]  = useState({ course: true, email: true, push: false, weekly: true })

  const [pwForm,    setPwForm]    = useState({ current: '', next: '', confirm: '' })
  const [pwSaved,   setPwSaved]   = useState(false)
  const [pwError,   setPwError]   = useState<string | null>(null)
  const [showCur,   setShowCur]   = useState(false)
  const [showNew,   setShowNew]   = useState(false)
  const changePasswordMutation = useChangePassword()

  const [emForm,  setEmForm]  = useState({ next: '', password: '' })
  const [emError, setEmError] = useState<string | null>(null)
  const [emSent,  setEmSent]  = useState(false)
  const requestEmailChange = useRequestEmailChange()
  const cancelEmailChange  = useCancelEmailChange()

  const handleRequestEmailChange = async () => {
    setEmError(null)
    const next = emForm.next.trim().toLowerCase()
    if (!next) { setEmError('Enter the address you want to use.'); return }
    if (next === (user?.email ?? '').toLowerCase()) {
      setEmError('That is already the address on your account.'); return
    }
    try {
      await requestEmailChange.mutateAsync({ newEmail: next, currentPassword: emForm.password })
      setEmSent(true)
      setEmForm({ next: '', password: '' })
    } catch (err: any) {
      /* The API's own message names the problem — already registered, wrong
         password, social account with nothing to confirm against. Repeating it
         beats a generic line that leaves the student guessing. */
      setEmError(err?.response?.data?.error?.message ?? 'Could not start the change. Please try again.')
    }
  }

  const handleCancelEmailChange = async () => {
    setEmError(null)
    try {
      await cancelEmailChange.mutateAsync()
      setEmSent(false)
    } catch {
      setEmError('Could not cancel. Please try again.')
    }
  }

  const handleChangePassword = async () => {
    setPwError(null)
    if (pwForm.next !== pwForm.confirm) { setPwError("New passwords don't match."); return }
    if (pwForm.next.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    try {
      await changePasswordMutation.mutateAsync({ currentPassword: pwForm.current, newPassword: pwForm.next })
      setPwSaved(true)
      setPwForm({ current: '', next: '', confirm: '' })
      setTimeout(() => setPwSaved(false), 3000)
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message
      setPwError(msg ?? 'Unable to change password. Please try again.')
    }
  }

  const { data: user, isLoading: userLoading } = useCurrentUser()
  const updateMutation = useUpdateProfile()

  /* Show "Request" tab for express accounts and rejected users */
  const showRequestTab = user?.signupType === 'express' || user?.enrollmentStatus === 'rejected'
  const MENU = showRequestTab
    ? [...BASE_MENU.slice(0, 4), { id: 'request', icon: FileText, label: 'Request' }, ...BASE_MENU.slice(4)]
    : BASE_MENU

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [profile, setProfile] = useState({ name: '', email: '', role: '', bio: '' })

  useEffect(() => {
    if (user) {
      setProfile({
        name:  user.name  ?? '',
        email: user.email ?? '',
        role:  user.headline ?? '',
        bio:   user.bio   ?? '',
      })
    }
  }, [user])

  const handleSave = async () => {
    setError(null)
    try {
      await updateMutation.mutateAsync({
        name:     profile.name.trim(),
        headline: profile.role,
        bio:      profile.bio,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message
        ?? err?.response?.data?.error?.details?.[0]?.message
      setError(msg ?? 'Unable to save changes. Please try again.')
    }
  }

  const handleLogout = async () => {
    await apiLogout()
    localStorage.removeItem('lms-cart')
    window.location.href = '/login'
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show"
      className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr] lg:grid-cols-[220px_1fr]">

      {/* ── Sidebar menu ──────────────────────────── */}
      <motion.div variants={fadeUp}
        className="rounded-2xl bg-[var(--color-bg-surface)] p-3 md:sticky md:top-[116px] md:self-start"
        style={{ border: '1px solid var(--color-border)' }}>
        <div className="space-y-0.5">
          {MENU.map(item => {
            const Icon  = item.icon
            const isAct = active === item.id
            return (
              <button key={item.id} onClick={() => setActive(item.id)}
                className="relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-left transition-colors"
                style={{ color: isAct ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                {isAct && (
                  <motion.div layoutId="settings-active"
                    className="absolute inset-0 rounded-xl"
                    style={{ background: 'var(--color-primary-light)', border: '1px solid rgba(0,87,184,0.18)' }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                )}
                <Icon size={15} className="relative z-10 flex-shrink-0"
                  style={{ color: isAct ? '#0057b8' : 'var(--color-text-muted)' }} />
                <span className="relative z-10">{item.label}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-hover-danger)]"
            style={{ color: 'var(--color-danger)' }}>
            <LogOut size={15} />Logout
          </button>
        </div>
      </motion.div>

      {/* ── Content panel ─────────────────────────── */}
      <motion.div variants={fadeUp} className="space-y-4 min-w-0">

        {active === 'profile' && (
            <div key="profile" className="space-y-4">
              <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
              <h2 className="mb-5 text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Profile Settings</h2>
              <div className="mb-6 flex items-center gap-4">
                <div className="relative">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full text-xl font-bold text-white"
                    style={{ background: 'var(--color-primary)' }}>
                    <AvatarImg src={user?.avatarUrl}
                      className="h-full w-full object-cover"
                      fallback={(profile.name?.trim()?.[0]?.toUpperCase() ?? '?')} />
                  </div>
                  <button className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-bg-surface)] shadow-md"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}
                    title="Photo upload coming soon">
                    <Camera size={12} />
                  </button>
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Profile Photo</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>PNG, JPG up to 5MB</p>
                </div>
              </div>
              {mounted && userLoading && (
                <div className="mb-4 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <Spinner size={12} />Loading your profile…
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {([
                  { label: 'Full Name', key: 'name',  type: 'text',  readOnly: false, placeholder: 'Your name' },
                  { label: 'Email',     key: 'email', type: 'email', readOnly: true,  placeholder: 'you@example.com' },
                  { label: 'Job Title', key: 'role',  type: 'text',  readOnly: false, placeholder: 'e.g. Frontend Developer' },
                ] as const).map(f => (
                  <div key={f.key}>
                    <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                      {f.label}{f.readOnly && <span className="ml-1 font-normal" style={{ color: 'var(--color-text-muted)' }}>(read-only)</span>}
                    </label>
                    <input type={f.type}
                      value={profile[f.key]}
                      readOnly={f.readOnly}
                      placeholder={f.placeholder}
                      onChange={e => !f.readOnly && setProfile({ ...profile, [f.key]: e.target.value })}
                      className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-all"
                      style={{
                        background: f.readOnly ? 'var(--color-bg-subtle)' : 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        color: f.readOnly ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                        cursor: f.readOnly ? 'not-allowed' : 'text',
                      }}
                      onFocus={e => { if (!f.readOnly) { e.currentTarget.style.border = '1.5px solid #0057b8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)' } }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }} />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Bio</label>
                  <textarea value={profile.bio} onChange={e => setProfile({ ...profile, bio: e.target.value })}
                    rows={3} placeholder="Tell us a bit about yourself..."
                    className="w-full resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none"
                    style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                    onFocus={e => { e.currentTarget.style.border = '1.5px solid #0057b8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)' }}
                    onBlur={e => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }} />
                </div>
              </div>
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs"
                    style={{ background: '#FEE2E2', color: 'var(--color-danger)' }}>
                    <AlertCircle size={13} />{error}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => user && setProfile({ name: user.name, email: user.email, role: user.headline ?? '', bio: user.bio ?? '' })}
                  className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
                  style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>Cancel</button>
                <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  disabled={updateMutation.isPending || (mounted && userLoading)}
                  className="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold text-white transition-all disabled:opacity-70"
                  style={{
                    background: saved ? '#22C55E' : '#0057b8',
                    boxShadow: saved ? '0 4px 14px rgba(34,197,94,0.28)' : '0 4px 14px rgba(0,87,184,0.28)',
                  }}>
                  {updateMutation.isPending
                    ? <><Spinner size={14} />Saving…</>
                    : saved
                      ? <><Check size={14} />Saved!</>
                      : 'Save changes'}
                </motion.button>
              </div>
            </div>
            {/* ── Email address ──────────────────────────────
                Nothing moves when this is submitted. The address is parked and
                a link goes to it; the account keeps using the current address
                until that link is clicked — so a typo here costs nothing, and
                somebody who has taken over a session still cannot move the
                account without the password. */}
            <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
              <div className="mb-1 flex items-center gap-2">
                <Mail size={15} style={{ color: 'var(--color-primary)' }} />
                <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Email Address</h2>
              </div>
              <p className="mb-5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                You sign in with <strong>{user?.email}</strong>.
              </p>

              {user?.pendingEmail ? (
                <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    Waiting for confirmation
                  </p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    We sent a link to <strong>{user.pendingEmail}</strong>. Open it from that
                    inbox to finish the change. Until then you keep signing in with{' '}
                    <strong>{user.email}</strong>.
                  </p>
                  <button
                    onClick={handleCancelEmailChange}
                    disabled={cancelEmailChange.isPending}
                    className="mt-3 text-xs font-semibold underline transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ color: 'var(--color-primary)' }}>
                    {cancelEmailChange.isPending ? 'Cancelling…' : 'Cancel this change'}
                  </button>
                </div>
              ) : emSent ? (
                <div className="rounded-xl p-4" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.28)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    Check your new inbox
                  </p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    Open the link we just sent. It expires in an hour.
                  </p>
                </div>
              ) : (
                <div className="space-y-3.5">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>New email address</label>
                    <input
                      type="email"
                      value={emForm.next}
                      onChange={e => setEmForm(p => ({ ...p, next: e.target.value }))}
                      placeholder="you@example.com"
                      className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
                      style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Confirm with your password</label>
                    <input
                      type="password"
                      value={emForm.password}
                      onChange={e => setEmForm(p => ({ ...p, password: e.target.value }))}
                      placeholder="Your current password"
                      className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
                      style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
                  </div>

                  {emError && (
                    <p className="text-xs" style={{ color: '#DC2626' }}>{emError}</p>
                  )}

                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    We will email a confirmation link to the new address. Your current
                    address keeps working until you open it.
                  </p>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={handleRequestEmailChange}
                    disabled={requestEmailChange.isPending || !emForm.next || !emForm.password}
                    className="flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
                    style={{ background: 'var(--color-primary)' }}>
                    {requestEmailChange.isPending ? 'Sending…' : 'Send confirmation link'}
                  </motion.button>
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
              <div className="mb-5 flex items-center gap-2">
                <Lock size={15} style={{ color: 'var(--color-primary)' }} />
                <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Change Password</h2>
              </div>
              <div className="space-y-3.5">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Current password</label>
                  <div className="relative">
                    <input
                      type={showCur ? 'text' : 'password'}
                      value={pwForm.current}
                      onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
                      placeholder="Your current password"
                      className="w-full rounded-xl px-3.5 py-2.5 text-sm pr-10 outline-none"
                      style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                      onFocus={e => { e.currentTarget.style.border = '1.5px solid #0057b8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)' }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
                    />
                    <button type="button" onClick={() => setShowCur(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-text-muted)' }}>
                      {showCur ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>New password</label>
                  <div className="relative">
                    <input
                      type={showNew ? 'text' : 'password'}
                      value={pwForm.next}
                      onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
                      placeholder="Min. 8 characters, 1 uppercase, 1 number"
                      className="w-full rounded-xl px-3.5 py-2.5 text-sm pr-10 outline-none"
                      style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                      onFocus={e => { e.currentTarget.style.border = '1.5px solid #0057b8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)' }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
                    />
                    <button type="button" onClick={() => setShowNew(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-text-muted)' }}>
                      {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Confirm new password</label>
                  <input
                    type="password"
                    value={pwForm.confirm}
                    onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                    placeholder="Repeat your new password"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
                    style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                    onFocus={e => { e.currentTarget.style.border = '1.5px solid #0057b8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)' }}
                    onBlur={e => { e.currentTarget.style.border = '1px solid var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
                  />
                </div>
              </div>
              <AnimatePresence>
                {pwError && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="mt-3.5 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs"
                    style={{ background: '#FEE2E2', color: 'var(--color-danger)' }}>
                    <AlertCircle size={13} />{pwError}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mt-5 flex justify-end">
                <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                  onClick={handleChangePassword}
                  disabled={changePasswordMutation.isPending || !pwForm.current || !pwForm.next || !pwForm.confirm}
                  className="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold text-white transition-all disabled:opacity-50"
                  style={{
                    background: pwSaved ? '#22C55E' : '#0057b8',
                    boxShadow: pwSaved ? '0 4px 14px rgba(34,197,94,0.28)' : '0 4px 14px rgba(0,87,184,0.28)',
                  }}>
                  {changePasswordMutation.isPending
                    ? <><Spinner size={14} />Updating…</>
                    : pwSaved
                      ? <><Check size={14} />Password updated!</>
                      : <><Lock size={14} />Update password</>}
                </motion.button>
              </div>
            </div>
            </div>
          )}

          {active === 'layout' && (
            <div key="layout" className="space-y-4">
              <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6" style={{ border: '1px solid var(--color-border)' }}>
                <div className="mb-1 flex items-center gap-2">
                  <Monitor size={16} style={{ color: 'var(--color-primary)' }} />
                  <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Navigation Layout</h2>
                </div>
                <p className="mb-6 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Choose how you want to navigate through LearnOS. Your preference is saved automatically.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <LayoutCard value="sidebar" label="Sidebar Navigation"
                    desc="Collapsible sidebar on the left with icon shortcuts"
                    selected={navLayout === 'sidebar'} onSelect={() => setNavLayout('sidebar')}
                    preview={<SidebarPreview />} />
                  <LayoutCard value="topbar" label="Top Navigation"
                    desc="Full-width top nav bar, more screen space for content"
                    selected={navLayout === 'topbar'} onSelect={() => setNavLayout('topbar')}
                    preview={<TopbarPreview />} />
                </div>
                <AnimatePresence mode="wait">
                  <motion.div key={navLayout}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="mt-5 flex items-center gap-3 rounded-2xl px-4 py-3"
                    style={{ background: 'rgba(0,87,184,0.06)', border: '1px solid rgba(0,87,184,0.18)' }}>
                    {navLayout === 'sidebar'
                      ? <PanelLeft size={16} style={{ color: 'var(--color-primary)' }} />
                      : <AlignJustify size={16} style={{ color: 'var(--color-primary)' }} />}
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {navLayout === 'sidebar'
                        ? <><span className="font-semibold">Sidebar layout active.</span> The left sidebar shows your main navigation. Use the collapse button to hide labels.</>
                        : <><span className="font-semibold">Top navigation active.</span> The sidebar is hidden. All pages are accessible from the top nav tabs.</>}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>
              <AnimatePresence>
                {navLayout === 'sidebar' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}
                    className="overflow-hidden rounded-2xl bg-[var(--color-bg-surface)]"
                    style={{ border: '1px solid var(--color-border)' }}>
                    <div className="p-6">
                      <h3 className="mb-4 text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Sidebar Options</h3>
                      <div className="space-y-3">
                        {[
                          { label: 'Show labels',   desc: 'Display text labels beside icons',      key: 'labels',  on: true  },
                          { label: 'Compact mode',  desc: 'Reduce padding for a denser sidebar',   key: 'compact', on: false },
                          { label: 'Auto-collapse', desc: 'Collapse sidebar when navigating away', key: 'auto',    on: false },
                        ].map(opt => (
                          <div key={opt.key} className="flex items-center justify-between rounded-xl p-3 hover:bg-[var(--color-bg-muted)] transition-colors"
                            style={{ border: '1px solid var(--color-border)' }}>
                            <div>
                              <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{opt.label}</p>
                              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{opt.desc}</p>
                            </div>
                            <Toggle on={opt.on} onToggle={() => {}} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {active === 'notifications' && (
            <div key="notifications" style={{ border: '1px solid var(--color-border)' }}
              className="rounded-2xl bg-[var(--color-bg-surface)] p-6">
              <h2 className="mb-5 text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Notification Preferences</h2>
              <div className="space-y-3">
                {[
                  { key: 'course',  label: 'Course updates',      desc: 'New lessons, announcements from instructors' },
                  { key: 'email',   label: 'Email notifications', desc: 'Receive updates via email' },
                  { key: 'push',    label: 'Push notifications',  desc: 'Browser and mobile push alerts' },
                  { key: 'weekly',  label: 'Weekly digest',       desc: 'A summary of your learning progress each week' },
                ].map(n => (
                  <div key={n.key} className="flex items-center justify-between gap-4 rounded-xl p-4 hover:bg-[var(--color-bg-muted)] transition-colors"
                    style={{ border: '1px solid var(--color-border)' }}>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{n.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{n.desc}</p>
                    </div>
                    <Toggle on={notifs[n.key as keyof typeof notifs]}
                      onToggle={() => setNotifs(p => ({ ...p, [n.key]: !p[n.key as keyof typeof notifs] }))} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {active === 'request' && (
            <div key="request">
              <RequestSection />
            </div>
          )}

          {active === 'privacy' && (
            <div key="privacy">
              <PrivacySecuritySection />
            </div>
          )}

          {/* BILLING IS NOT COMING SOON. It said so for as long as /orders -
              a finished Purchase History page, receipts and all - sat in the
              app with no link pointing at it from anywhere. The section that
              should have been the way in was a placeholder apologising for
              itself. */}
          {active === 'billing' && (
            <div key="billing" style={{ border: '1px solid var(--color-border)' }}
              className="rounded-2xl bg-[var(--color-bg-surface)] p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--color-primary-light)', border: '1px solid rgba(0,87,184,0.18)', color: 'var(--color-primary)' }}>
                  <Receipt size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Purchase History</p>
                  <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                    Every course you have paid for, what it cost, and the receipt for it.
                  </p>
                  <Link href="/orders"
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'var(--color-primary)' }}>
                    View purchases
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {(['language'] as const).includes(active as never) && (
            <div key={active} style={{ border: '1px solid var(--color-border)' }}
              className="rounded-2xl bg-[var(--color-bg-surface)] p-10 flex flex-col items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl text-2xl"
                style={{ background: 'var(--color-primary-light)', border: '1px solid rgba(0,87,184,0.18)' }}>
                <Globe size={24} />
              </div>
              <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Coming soon</p>
              <p className="text-sm text-center max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
                This settings section is under construction. Check back soon!
              </p>
            </div>
          )}

      </motion.div>
    </motion.div>
  )
}

