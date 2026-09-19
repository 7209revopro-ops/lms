'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronDown, Check, Camera } from 'lucide-react'
import { useUpdateUser, type AdminUser, type AdminUserRole } from '@/lib/api/users'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'
import { api } from '@/lib/axios'
import type { CurrentAdmin } from '@/lib/api/user'
import { AvatarImg } from '@/components/ui/AvatarImg'

/* ── Custom dark select ──────────────────────────── */
function SelectField<T extends string>({
  label, value, options, onChange, disabled, error,
}: {
  label:    string
  value:    T
  options:  { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
  error?:   string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value)

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {label}
      </label>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(v => !v)}
          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all"
          style={{
            background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${error ? '#ef4444' : open ? 'rgba(0,87,184,0.5)' : 'rgba(255,255,255,0.09)'}`,
            boxShadow: open ? '0 0 0 3px rgba(0,87,184,0.08)' : 'none',
            color: disabled ? 'rgba(255,255,255,0.3)' : value ? 'white' : 'rgba(255,255,255,0.35)',
          }}
        >
          <span>{current?.label ?? `Select ${label.toLowerCase()}…`}</span>
          {!disabled && (
            <ChevronDown size={13} style={{
              color: 'rgba(255,255,255,0.35)',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
              flexShrink: 0,
            }} />
          )}
        </button>

        {/* Outside AnimatePresence on purpose — see the note in AddUserModal:
            a fragment hides the panel from AnimatePresence's key tracking and
            kills its exit animation. */}
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

/* ── Toggle switch ───────────────────────────────── */
function Toggle({ label, checked, onChange, color }: {
  label:    string
  checked:  boolean
  onChange: (v: boolean) => void
  color:    string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-white/[0.04]"
    >
      <div
        className="relative h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? color : 'rgba(255,255,255,0.12)' }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? 'translateX(16px)' : 'translateX(2px)' }}
        />
      </div>
      <span className="text-xs font-medium" style={{ color: checked ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.4)' }}>
        {label}
      </span>
    </button>
  )
}

/* ── Role options ────────────────────────────────── */
const ROLE_OPTIONS_BY_EDITOR: Record<string, { value: AdminUserRole; label: string }[]> = {
  super_admin: [
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'admin',       label: 'Admin' },
    { value: 'sub_admin',   label: 'Sub Admin' },
    { value: 'instructor',  label: 'Instructor' },
  ],
  admin: [
    { value: 'sub_admin',  label: 'Sub Admin' },
    { value: 'instructor', label: 'Instructor' },
  ],
}

const ALL_ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  sub_admin:   'Sub Admin',
  instructor:  'Instructor',
  support:     'Support Staff',
  student:     'Student',
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

const CATEGORY_TO_PROGRAM: Record<string, 'ai' | 'digital_marketing' | 'forex' | 'jura'> = {
  'ai':                'ai',
  'digital-marketing': 'digital_marketing',
  '4x-trading':        'forex',
  'jura':              'jura',
}

function needsProgram(role: AdminUserRole) {
  return role === 'sub_admin' || role === 'instructor'
}

/* ── Modal ───────────────────────────────────────── */
interface Props {
  user:      AdminUser
  me:        CurrentAdmin
  onClose:   () => void
  onSuccess: () => void
}

export function EditUserModal({ user, me, onClose, onSuccess }: Props) {
  const [name,          setName]          = useState(user.name)
  const [email,         setEmail]         = useState(user.email)
  const [role,          setRole]          = useState<AdminUserRole>(user.role)
  const [program,       setProgram]       = useState<'ai' | 'digital_marketing' | 'forex' | 'jura' | ''>(() => {
    if (user.role === 'instructor' && user.category) {
      return CATEGORY_TO_PROGRAM[user.category] ?? ''
    }
    if (user.role === 'sub_admin' && user.program) {
      return user.program
    }
    return ''
  })
  const [isActive,      setIsActive]      = useState(user.isActive)
  const [isVerified,    setIsVerified]    = useState(user.isVerified)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatarUrl ?? null)
  const [avatarFile,    setAvatarFile]    = useState<File | null>(null)
  const [uploading,     setUploading]     = useState(false)
  const [errors,        setErrors]        = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const updateUser = useUpdateUser()
  const toast      = useToast()

  const roleOptions = ROLE_OPTIONS_BY_EDITOR[me.role] ?? []
  const canEditRole = roleOptions.length > 0

  const activeRole = canEditRole ? role : user.role

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const errs: Record<string, string> = {}
    if (needsProgram(activeRole) && !program) errs.program = 'Program is required'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    try {
      let avatarUrl: string | undefined
      if (avatarFile) {
        setUploading(true)
        try {
          const fd = new FormData()
          fd.append('file', avatarFile)
          const r = await api.post<{ success: true; data: { url: string } }>('/uploads/document', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          avatarUrl = r.data.data.url
        } finally {
          setUploading(false)
        }
      }

      const dto: Parameters<typeof updateUser.mutateAsync>[0] = {
        id: user.id, name: name.trim(), email: email.trim(), isActive, isVerified,
      }
      if (canEditRole && role !== user.role) dto.role = role
      if (avatarUrl) (dto as any).avatarUrl = avatarUrl

      /* Program / category mapping */
      if (needsProgram(activeRole) && program) {
        if (activeRole === 'instructor') {
          dto.category = PROGRAM_TO_CATEGORY[program]
        } else {
          dto.program = program as 'ai' | 'digital_marketing' | 'forex' | 'jura'
        }
      } else if (!needsProgram(activeRole)) {
        dto.category = null
      }

      await updateUser.mutateAsync(dto)
      toast.success('User updated')
      onSuccess()
    } catch (err: any) {
      toast.error('Update failed', err?.response?.data?.error?.message)
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

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          /* Same missing scroll container as AddUserModal — see the note there.
             This panel is taller still (it carries the toggles as well), so it
             overflowed a laptop viewport even before the phone case. */
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
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#0057b8' }}>Edit User</p>
              <h2 className="mt-0.5 text-base font-bold text-white">{user.name}</h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.email}</p>
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
              {/* Avatar photo */}
              <div className="flex items-center gap-4 pb-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setAvatarFile(f)
                    setAvatarPreview(URL.createObjectURL(f))
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full transition-all"
                  style={{
                    border: avatarPreview ? '2px solid rgba(0,87,184,0.5)' : '2px dashed rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.05)',
                  }}
                >
                  <AvatarImg src={avatarPreview} className="h-full w-full object-cover"
                    fallback={
                      <div className="flex h-full w-full items-center justify-center">
                        <Camera size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                      </div>
                    } />
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <Camera size={14} className="text-white" />
                  </div>
                </button>
                <div>
                  <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>Profile photo</p>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="mt-1 text-[11px] transition-colors hover:opacity-80"
                    style={{ color: '#0057b8' }}
                  >
                    {avatarPreview ? 'Change photo' : 'Upload photo'}
                  </button>
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Name</label>
                <input
                  value={name} onChange={e => setName(e.target.value)} required
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white transition-all"
                  style={inputStyle} {...focusStyle}
                />
              </div>

              {/* Email */}
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Email</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white transition-all"
                  style={inputStyle} {...focusStyle}
                />
              </div>

              {/* Role */}
              {canEditRole ? (
                <SelectField
                  label="Role"
                  value={role}
                  options={roleOptions}
                  onChange={v => { setRole(v); setProgram(''); setErrors({}) }}
                />
              ) : (
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>Role</label>
                  <div className="rounded-xl px-3 py-2.5 text-sm"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)' }}>
                    {ALL_ROLE_LABELS[user.role] ?? user.role}
                  </div>
                </div>
              )}

              {/* Program — for sub_admin and instructor */}
              {needsProgram(activeRole) && (
                <SelectField
                  label="Program"
                  value={program}
                  options={PROGRAM_OPTIONS}
                  onChange={v => { setProgram(v); setErrors(prev => ({ ...prev, program: '' })) }}
                  error={errors.program}
                />
              )}

              {/* Toggles */}
              <div className="flex gap-2 rounded-xl p-0.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <Toggle label="Active"   checked={isActive}   onChange={setIsActive}   color="#22c55e" />
                <div className="w-px self-stretch" style={{ background: 'rgba(255,255,255,0.07)' }} />
                <Toggle label="Verified" checked={isVerified} onChange={setIsVerified} color="#3b82f6" />
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onClose}
                className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/[0.07]"
                style={{ color: 'rgba(255,255,255,0.5)' }}>
                Cancel
              </button>
              <button type="submit" disabled={updateUser.isPending || uploading}
                className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}>
                {(updateUser.isPending || uploading) && <Spinner size={13} />}
                {uploading ? 'Uploading…' : 'Save changes'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
