'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronDown, Check, Eye, EyeOff, Camera } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import Spinner from '@/components/ui/Spinner'
import { api } from '@/lib/axios'
import { useToast } from '@/store/ui.store'
import type { CurrentAdmin } from '@/lib/api/user'
import type { AdminUserRole } from '@/lib/api/users'

/* ── Custom dark select ──────────────────────────── */
function SelectField<T extends string>({
  label, value, options, onChange, locked, error,
}: {
  label:    string
  value:    T
  options:  { value: T; label: string }[]
  onChange: (v: T) => void
  locked?:  boolean
  error?:   string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value)

  if (locked) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</label>
        <div className="rounded-xl px-3 py-2.5 text-sm"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)' }}>
          {current?.label ?? '—'}
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {label}
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${error ? '#ef4444' : open ? 'rgba(0,87,184,0.5)' : 'rgba(255,255,255,0.09)'}`,
            boxShadow: open ? '0 0 0 3px rgba(0,87,184,0.08)' : 'none',
            color: value ? 'white' : 'rgba(255,255,255,0.35)',
          }}
        >
          <span>{current?.label ?? `Select ${label.toLowerCase()}…`}</span>
          <ChevronDown size={13} style={{
            color: 'rgba(255,255,255,0.35)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }} />
        </button>

        {/* The click-catcher sits OUTSIDE AnimatePresence deliberately.
            AnimatePresence tracks its direct children by key, and these two
            used to share a fragment — which hid the panel behind it, so the
            exit animation never ran and the menu blinked out instead of
            fading. The catcher wants to disappear at once anyway; only the
            panel should animate away. */}
        {open && <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />}
        <AnimatePresence>
          {open && (
            <motion.div
              key="menu"
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.1 }}
              className="absolute left-0 bottom-full z-[61] mb-1 w-full overflow-hidden rounded-xl py-1"
              style={{
                background: '#131525',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
              }}
            >
              {options.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06]"
                  style={{ color: o.value === value ? '#0057b8' : 'rgba(255,255,255,0.8)' }}
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {o.value === value && <Check size={12} />}
                  </span>
                  {o.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  )
}

/* ── Role + program data ─────────────────────────── */
const ROLE_OPTIONS_BY_CREATOR: Record<string, { value: AdminUserRole; label: string }[]> = {
  super_admin: [
    { value: 'admin',      label: 'Admin' },
    { value: 'sub_admin',  label: 'Sub Admin' },
    { value: 'instructor', label: 'Instructor' },
  ],
  admin: [
    { value: 'sub_admin',  label: 'Sub Admin' },
    { value: 'instructor', label: 'Instructor' },
  ],
  sub_admin: [
    { value: 'instructor', label: 'Instructor' },
  ],
}

const PROGRAM_OPTIONS: { value: 'ai' | 'digital_marketing' | 'forex' | 'jura'; label: string }[] = [
  { value: 'ai',                label: 'AI' },
  { value: 'digital_marketing', label: 'Digital Marketing' },
  { value: 'forex',             label: 'FOREX Trading' },
  { value: 'jura',              label: 'JURA' },
]

const PROGRAM_TO_CATEGORY: Record<string, '4x-trading' | 'digital-marketing' | 'ai' | 'jura'> = {
  ai:                'ai',
  digital_marketing: 'digital-marketing',
  forex:             '4x-trading',
  jura:              'jura',
}

function needsProgram(role: AdminUserRole) {
  return role === 'sub_admin' || role === 'instructor'
}

/* ── Modal ───────────────────────────────────────── */
interface Props {
  me:      CurrentAdmin
  open:    boolean
  onClose: () => void
}

export function AddUserModal({ me, open, onClose }: Props) {
  const roleOptions = ROLE_OPTIONS_BY_CREATOR[me.role] ?? []
  const defaultRole = roleOptions[0]?.value ?? 'instructor'

  const [name,          setName]          = useState('')
  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [showPass,      setShowPass]      = useState(false)
  const [role,          setRole]          = useState<AdminUserRole>(defaultRole)
  const [program,       setProgram]       = useState<'ai' | 'digital_marketing' | 'forex' | 'jura' | ''>('')
  const [avatarFile,    setAvatarFile]    = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [uploading,     setUploading]     = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [errors,        setErrors]        = useState<Record<string, string>>({})

  const fileRef = useRef<HTMLInputElement>(null)
  const qc      = useQueryClient()
  const toast   = useToast()

  useEffect(() => {
    if (open) {
      setName(''); setEmail(''); setPassword(''); setShowPass(false)
      setRole(defaultRole); setProgram('')
      setAvatarFile(null); setAvatarPreview(null)
      setErrors({})
    }
  }, [open, defaultRole])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!avatarFile) e.avatar = 'Profile photo is required'
    if (needsProgram(role) && !program) e.program = 'Program is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      let avatarUrl: string | undefined
      if (avatarFile) {
        setUploading(true)
        const fd = new FormData()
        fd.append('file', avatarFile)
        const r = await api.post<{ success: true; data: { url: string } }>('/uploads/document', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        avatarUrl = r.data.data.url
        setUploading(false)
      }

      const body: Record<string, unknown> = {
        name: name.trim(), email: email.trim(), password, role,
      }
      if (avatarUrl) body.avatarUrl = avatarUrl
      if (needsProgram(role) && program) {
        if (role === 'instructor') {
          body.category = PROGRAM_TO_CATEGORY[program]
        } else {
          body.program = program
        }
      }

      await api.post('/admin/users', body)
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
      toast.success(`${name.trim()} created successfully`)
      onClose()
    } catch (err: any) {
      setUploading(false)
      toast.error('Creation failed', err?.response?.data?.error?.message)
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.09)',
    outline: 'none',
  }

  const focusStyle = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.border = '1px solid rgba(0,87,184,0.5)'
      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)'
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.border = '1px solid rgba(255,255,255,0.09)'
      e.currentTarget.style.boxShadow = 'none'
    },
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        /* `overflow-y-auto` + a max height, the same pair every other modal in
           the app already carries. Without them this panel had no scroll
           container at all: six fields, an avatar well and a submit button come
           to roughly 650px, and a `fixed inset-0` backdrop does not scroll. On
           anything shorter — a 1366x768 laptop, a phone held sideways, a phone
           once the keyboard is up — the overflow simply had nowhere to go and
           the top of the form was unreachable. */
        className="relative w-full max-w-md overflow-y-auto rounded-2xl"
        style={{
          background: 'linear-gradient(145deg, #0e1022 0%, #0a0c18 100%)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 40px 80px rgba(0,0,0,0.8)',
          zIndex: 1,
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#0057b8' }}>Add User</p>
            <h2 className="mt-0.5 text-base font-bold text-white">New Staff Account</h2>
          </div>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08]"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5">
          <div className="space-y-3">

            {/* Avatar upload — required */}
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Profile photo <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setAvatarFile(f)
                    setAvatarPreview(URL.createObjectURL(f))
                    setErrors(prev => ({ ...prev, avatar: '' }))
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full transition-all"
                  style={{
                    border: errors.avatar
                      ? '2px solid #ef4444'
                      : avatarPreview
                        ? '2px solid rgba(0,87,184,0.5)'
                        : '2px dashed rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.05)',
                  }}
                >
                  {avatarPreview
                    ? <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                    : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Camera size={18} style={{ color: errors.avatar ? '#ef4444' : 'rgba(255,255,255,0.3)' }} />
                      </div>
                    )
                  }
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <Camera size={14} className="text-white" />
                  </div>
                </button>
                <div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="text-sm font-medium transition-colors hover:opacity-80"
                    style={{ color: errors.avatar ? '#ef4444' : '#0057b8' }}
                  >
                    {avatarPreview ? 'Change photo' : 'Upload photo'}
                  </button>
                  {errors.avatar
                    ? <p className="mt-0.5 text-[11px]" style={{ color: '#ef4444' }}>{errors.avatar}</p>
                    : <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>JPG, PNG, WebP</p>
                  }
                </div>
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Full name</label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                required placeholder="e.g. John Smith"
                className="w-full rounded-xl px-3 py-2.5 text-sm text-white transition-all placeholder:text-white/20"
                style={inputStyle} {...focusStyle}
              />
            </div>

            {/* Email */}
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                required placeholder="user@example.com"
                className="w-full rounded-xl px-3 py-2.5 text-sm text-white transition-all placeholder:text-white/20"
                style={inputStyle} {...focusStyle}
              />
            </div>

            {/* Password */}
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password} onChange={e => setPassword(e.target.value)}
                  required minLength={8} placeholder="Min 8 characters"
                  className="w-full rounded-xl py-2.5 pl-3 pr-10 text-sm text-white transition-all placeholder:text-white/20"
                  style={inputStyle} {...focusStyle}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Role */}
            <SelectField
              label="Role"
              value={role}
              options={roleOptions}
              onChange={v => { setRole(v); setProgram(''); setErrors(prev => ({ ...prev, program: '' })) }}
              locked={roleOptions.length <= 1}
            />

            {/* Program — required for sub_admin and instructor */}
            {needsProgram(role) && (
              <SelectField
                label="Program"
                value={program}
                options={PROGRAM_OPTIONS}
                onChange={v => { setProgram(v); setErrors(prev => ({ ...prev, program: '' })) }}
                error={errors.program}
              />
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/[0.07]"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </button>
            <button type="submit" disabled={loading || uploading}
              className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}>
              {(loading || uploading) && <Spinner size={13} />}
              {uploading ? 'Uploading…' : loading ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
