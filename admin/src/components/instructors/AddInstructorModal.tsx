'use client'

import { useState, useRef, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, User, Mail, Lock, Eye, EyeOff, FileText,
  AlertCircle, CheckCircle2, GraduationCap, Camera,
  TrendingUp, Cpu, BarChart2, ShieldCheck, Building2,
} from 'lucide-react'
import { useCreateInstructor } from '@/lib/api/instructors'
import { useOrganizations } from '@/lib/api/organizations'
import { useCurrentUser } from '@/lib/api/user'
import { useOrgStore } from '@/store/org.store'
import Spinner from '@/components/ui/Spinner'
import { api } from '@/lib/axios'

/* ── Validation schema ──────────────────────────────── */
const schema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters').max(100),
  email:    z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  headline: z.string().max(255).optional(),
  bio:      z.string().max(2000).optional(),
  role:     z.enum(['instructor', 'admin']).default('instructor'),
  category: z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura'], { required_error: 'Please select a program category' }),
  /* Lend this instructor to the other academy. Only an admin or super admin
     may set it — the API rejects it from anyone else rather than silently
     dropping it, so the form hides it instead of letting it fail. */
  sharedAcrossOrgs: z.boolean().optional(),
})
type Values = z.infer<typeof schema>

/* ── Category options ───────────────────────────────── */
const CATS = [
  { value: '4x-trading',        label: 'FOREX Trading',     color: '#fb923c', Icon: TrendingUp },
  { value: 'jura',              label: 'JURA',              color: '#8B5CF6', Icon: TrendingUp },
  { value: 'digital-marketing', label: 'Digital Marketing', color: '#60a5fa', Icon: BarChart2 },
  { value: 'ai',                label: 'AI',                color: '#c084fc', Icon: Cpu },
] as const

/* ── Dark field wrapper ─────────────────────────────── */
function DField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: 'rgba(255,255,255,0.32)' }}>{label}</label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-1 flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
            <AlertCircle size={10} />{error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

const inpBase = 'w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/20 transition-all'
const inpStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' } as const

/* ── Modal component ────────────────────────────────── */
interface AddInstructorModalProps {
  open:    boolean
  onClose: () => void
}

export function AddInstructorModal({ open, onClose }: AddInstructorModalProps) {
  const [showPw, setShowPw]               = useState(false)
  const [success, setSuccess]             = useState(false)
  const [avatarFile, setAvatarFile]       = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarError, setAvatarError]     = useState<string | null>(null)
  const [uploading, setUploading]         = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { mutateAsync, isPending, error: apiError } = useCreateInstructor()

  /* Academy - see the note in AddStudentModal. A super admin working from
     "All Orgs" has no implicit academy, so without this the account is
     created belonging to none. Required for them, absent for everyone else. */
  const { data: me } = useCurrentUser()
  const isSuper = me?.role === 'super_admin'
  const activeOrgId = useOrgStore(st => st.activeOrgId)
  const { data: orgs } = useOrganizations(isSuper)
  const [orgId, setOrgId] = useState<string>('')
  const [orgError, setOrgError] = useState<string | null>(null)
  useEffect(() => {
    if (isSuper && activeOrgId && !orgId) setOrgId(activeOrgId)
  }, [isSuper, activeOrgId, orgId])

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'instructor' },
  })

  const roleVal     = watch('role')
  const categoryVal = watch('category') ?? ''

  const serverError = (() => {
    if (!apiError) return null
    const e = apiError as { response?: { data?: { error?: { message?: string } } } }
    return e.response?.data?.error?.message ?? 'Failed to create instructor. Please try again.'
  })()

  const onSubmit = async (values: Values) => {
    if (!avatarFile) { setAvatarError('Profile photo is required'); return }
    setAvatarError(null)
    setUploading(true)
    let avatarUrl = ''
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
    if (isSuper && !orgId) { setOrgError('Select which academy this account belongs to'); return }
    setOrgError(null)
    await mutateAsync({
      name:     values.name,
      email:    values.email,
      password: values.password,
      role:     values.role,
      headline: values.headline || undefined,
      bio:      values.bio      || undefined,
      category: values.category,
      avatarUrl,
      ...(values.sharedAcrossOrgs ? { sharedAcrossOrgs: true } : {}),
      ...(isSuper && orgId ? { organizationId: orgId } : {}),
    })
    setSuccess(true)
    setTimeout(() => {
      setSuccess(false)
      reset()
      setAvatarFile(null)
      setAvatarPreview(null)
      onClose()
    }, 1800)
  }

  const handleClose = () => {
    if (isPending || uploading) return
    reset()
    setSuccess(false)
    setAvatarFile(null)
    setAvatarPreview(null)
    setAvatarError(null)
    onClose()
  }

  const isSubmitting = isPending || uploading

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="add-instructor-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={handleClose}
        >
          <motion.div
            key="add-instructor-modal"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-lg overflow-y-auto rounded-2xl shadow-2xl"
            style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '92vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ background: 'rgba(0,87,184,0.20)', border: '1px solid rgba(0,87,184,0.30)' }}>
                <GraduationCap size={18} style={{ color: '#60a5fa' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Add Instructor</p>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>Create a new instructor account</p>
              </div>
              <button onClick={handleClose}
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/8"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                <X size={15} />
              </button>
            </div>

            {/* Success */}
            <AnimatePresence>
              {success && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-3 px-6 py-12"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-full"
                    style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.30)' }}>
                    <CheckCircle2 size={30} style={{ color: '#34d399' }} />
                  </div>
                  <p className="text-sm font-semibold text-white">Instructor created!</p>
                  <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    The new instructor can now log in to the admin portal.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form */}
            {!success && (
              <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">

                {/* Server error */}
                <AnimatePresence>
                  {serverError && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs"
                      style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                      <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />{serverError}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Avatar */}
                <div className="flex flex-col items-center gap-2 pb-1">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      setAvatarFile(f)
                      setAvatarPreview(URL.createObjectURL(f))
                      setAvatarError(null)
                    }} />
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="group relative h-24 w-24 overflow-hidden rounded-full transition-all"
                    style={{
                      border: avatarError
                        ? '2px solid rgba(239,68,68,0.6)'
                        : avatarPreview
                        ? '2px solid #3b82f6'
                        : '2px dashed rgba(255,255,255,0.18)',
                      background: avatarPreview ? 'transparent' : 'rgba(255,255,255,0.04)',
                      boxShadow: avatarPreview ? '0 0 0 4px rgba(59,130,246,0.12)' : undefined,
                    }}
                  >
                    {avatarPreview
                      ? <img src={avatarPreview} alt="Preview" className="h-full w-full object-cover" />
                      : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5">
                          <Camera size={20} style={{ color: avatarError ? '#f87171' : 'rgba(255,255,255,0.22)' }}
                            className="transition-colors group-hover:!text-blue-400" />
                          <span className="text-[9px] font-medium uppercase tracking-wider"
                            style={{ color: 'rgba(255,255,255,0.18)' }}>Upload</span>
                        </div>
                      )
                    }
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                      <Camera size={18} className="text-white" />
                    </div>
                  </button>
                  <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>
                    Profile photo <span style={{ color: '#f87171' }}>*</span>
                  </p>
                  <AnimatePresence>
                    {avatarError && (
                      <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
                        <AlertCircle size={10} />{avatarError}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Name */}
                <DField label="Full Name *" error={errors.name?.message}>
                  <div className="relative">
                    <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: 'rgba(255,255,255,0.22)' }} />
                    <input {...register('name')} placeholder="Jane Doe"
                      className={`${inpBase} pl-9`} style={inpStyle} />
                  </div>
                </DField>

                {/* Role toggle */}
                <DField label="Role *" error={errors.role?.message}>
                  <div className="flex gap-1.5 rounded-xl p-1.5"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    {(['instructor', 'admin'] as const).map(r => (
                      <button key={r} type="button"
                        onClick={() => {
                          setValue('role', r, { shouldValidate: true })
                          /* The "Available to both organizations" box is only
                             rendered for an instructor, but unmounting a
                             checkbox does not clear the form value behind it —
                             so ticking it, switching to Admin and saving sent
                             sharedAcrossOrgs:true with role 'admin', which the
                             API refuses with INVALID_SHARED_ROLE. The error
                             named a control that was no longer on the screen.

                             setValue, not a DOM write: React Hook Form does not
                             see `input.value = x` (CLAUDE.md). */
                          if (r !== 'instructor') setValue('sharedAcrossOrgs', false)
                        }}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all"
                        style={roleVal === r
                          ? {
                              background: r === 'instructor'
                                ? 'linear-gradient(135deg,#0057b8,#0041a3)'
                                : 'linear-gradient(135deg,#7c3aed,#6d28d9)',
                              color: 'white',
                              boxShadow: r === 'instructor'
                                ? '0 2px 10px rgba(0,87,184,0.38)'
                                : '0 2px 10px rgba(124,58,237,0.38)',
                            }
                          : { color: 'rgba(255,255,255,0.32)' }
                        }
                      >
                        {r === 'instructor'
                          ? <GraduationCap size={12} />
                          : <ShieldCheck size={12} />}
                        {r === 'instructor' ? 'Instructor' : 'Admin'}
                      </button>
                    ))}
                  </div>
                </DField>

                {/* Academy - super admins only */}
                {isSuper && (
                  <DField label="Academy *" error={orgError ?? undefined}>
                    <div className="flex flex-wrap gap-2">
                      {(orgs ?? []).map(o => {
                        const active = orgId === o.id
                        return (
                          <button key={o.id} type="button"
                            onClick={() => { setOrgError(null); setOrgId(o.id) }}
                            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                            style={active
                              ? { background: 'rgba(47,107,255,0.14)', border: '1px solid rgba(47,107,255,0.45)', color: '#7FA8FF' }
                              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.32)' }
                            }>
                            <Building2 size={11} />{o.name}
                          </button>
                        )
                      })}
                    </div>
                  </DField>
                )}

                {/* Category chips */}
                <DField label="Program Category *" error={errors.category?.message}>
                  <div className="flex flex-wrap gap-2">
                    {CATS.map(({ value, label, color, Icon }) => {
                      const active = categoryVal === value
                      return (
                        <button key={value} type="button"
                          onClick={() => setValue('category', value as Values['category'], { shouldValidate: true })}
                          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                          style={active
                            ? { background: `${color}18`, border: `1px solid ${color}45`, color }
                            : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.32)' }
                          }
                        >
                          <Icon size={11} />{label}
                        </button>
                      )
                    })}
                  </div>
                </DField>

                {/* Email */}
                <DField label="Email Address *" error={errors.email?.message}>
                  <div className="relative">
                    <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: 'rgba(255,255,255,0.22)' }} />
                    <input {...register('email')} type="email" placeholder="jane@example.com"
                      className={`${inpBase} pl-9`} style={inpStyle} />
                  </div>
                </DField>

                {/* Password */}
                <DField label="Password *" error={errors.password?.message}>
                  <div className="relative">
                    <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: 'rgba(255,255,255,0.22)' }} />
                    <input {...register('password')} type={showPw ? 'text' : 'password'}
                      placeholder="Min. 8 characters"
                      className={`${inpBase} pl-9 pr-9`} style={inpStyle} />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                      style={{ color: 'rgba(255,255,255,0.32)' }}>
                      {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </DField>

                {/* Available to both academies.

                    Shown only to roles the API will actually accept it from —
                    a sub-admin who ticked it would get a 403, so the control
                    is hidden rather than offered and then refused. Instructors
                    only: the API rejects it on any other role. */}
                {(me?.role === 'admin' || me?.role === 'super_admin') && roleVal === 'instructor' && (
                  <label
                    className="flex items-start gap-3 rounded-xl px-3 py-3 cursor-pointer transition-colors"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <input
                      type="checkbox"
                      {...register('sharedAcrossOrgs')}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-[var(--color-primary,#0057B8)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.88)' }}>
                        Available to both organizations
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        Both academies can see this instructor and schedule classes for them.
                        This account still belongs to the academy creating it.
                      </span>
                    </span>
                  </label>
                )}

                {/* Headline */}
                <DField label="Headline" error={errors.headline?.message}>
                  <div className="relative">
                    <FileText size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: 'rgba(255,255,255,0.22)' }} />
                    <input {...register('headline')} placeholder="e.g. Senior Trader & Educator"
                      className={`${inpBase} pl-9`} style={inpStyle} />
                  </div>
                </DField>

                {/* Bio */}
                <DField label="Bio" error={errors.bio?.message}>
                  <textarea {...register('bio')} rows={3} placeholder="Short instructor bio…"
                    className={`${inpBase} resize-none`} style={inpStyle} />
                </DField>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-1">
                  <button type="button" onClick={handleClose} disabled={isSubmitting}
                    className="rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
                    style={{ color: 'rgba(255,255,255,0.45)' }}>
                    Cancel
                  </button>
                  <motion.button
                    type="submit" disabled={isSubmitting}
                    whileHover={{ y: -1, boxShadow: '0 6px 20px rgba(0,87,184,0.38)' }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)' }}>
                    {isSubmitting
                      ? <><Spinner size={14} variant="white" />{uploading ? 'Uploading…' : 'Creating…'}</>
                      : <>Create Instructor</>}
                  </motion.button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
