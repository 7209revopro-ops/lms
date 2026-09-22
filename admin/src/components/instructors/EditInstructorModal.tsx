'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, User, Mail, FileText, Camera, AlertCircle,
  GraduationCap, TrendingUp, Cpu, BarChart2, ShieldCheck,
} from 'lucide-react'
import { useUpdateUser, type AdminUser } from '@/lib/api/users'
import { useCurrentUser } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'
import { api } from '@/lib/axios'
import { useToast } from '@/store/ui.store'
import { Button, MotionButton } from '@/components/ui/button'
import { AvatarImg } from '@/components/ui/AvatarImg'

/* ── Category options ───────────────────────────────── */
const CATS = [
  { value: '4x-trading',        label: 'FOREX Trading',     color: '#fb923c', Icon: TrendingUp },
  { value: 'jura',              label: 'JURA',              color: '#8B5CF6', Icon: TrendingUp },
  { value: 'digital-marketing', label: 'Digital Marketing', color: '#60a5fa', Icon: BarChart2 },
  { value: 'ai',                label: 'AI',                color: '#c084fc', Icon: Cpu },
] as const

interface Props {
  user:      AdminUser
  onClose:   () => void
  onSuccess: () => void
}

export function EditInstructorModal({ user, onClose, onSuccess }: Props) {
  const update = useUpdateUser()
  const toast  = useToast()

  const [name,     setName]     = useState(user.name)
  const [email,    setEmail]    = useState(user.email)
  const [headline, setHeadline] = useState(user.headline ?? '')
  const [bio,      setBio]      = useState(user.bio ?? '')
  const [role,     setRole]     = useState<'instructor' | 'admin'>(
    user.role === 'admin' ? 'admin' : 'instructor'
  )
  const [category,      setCategory]      = useState<string>(user.category ?? '')
  /* LENDING THIS INSTRUCTOR TO THE OTHER ACADEMY.
     The API has accepted `sharedAcrossOrgs` on this PATCH since the feature
     shipped; no screen ever sent it. Add Instructor could tick the box at
     creation and nothing could tick it afterwards — so lending an instructor
     who already existed meant deleting and recreating the account, losing
     their classes with it, and un-lending was impossible by any route. */
  const [shared,        setShared]        = useState(user.sharedAcrossOrgs === true)
  const [error,         setError]         = useState<string | null>(null)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  /* Photo */
  const [avatarFile,    setAvatarFile]    = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatarUrl ?? null)
  const [uploading,     setUploading]     = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: me } = useCurrentUser()
  /* Two conditions, and they are different questions. WHO: only an admin or
     super admin — the API answers 403 to anyone else, and a control that is
     offered and then refused is worse than one that was never there. WHOSE:
     the academy that OWNS the instructor. A lent instructor is administered by
     both academies, but the lending itself is the owner's decision and the
     server now refuses it from the borrower (BORROWED_INSTRUCTOR). A super
     admin carries no organizationId and stands outside the comparison. */
  const mayShare = me?.role === 'admin' || me?.role === 'super_admin'
  const ownsThem = me?.role === 'super_admin'
    || (!!me?.organizationId && !!user.organizationId
        && String(me.organizationId) === String(user.organizationId))
  const canLend  = mayShare && ownsThem

  const isPending = update.isPending || uploading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!category) { setCategoryError('Please select a program category'); return }
    setCategoryError(null)

    let newAvatarUrl: string | undefined
    if (avatarFile) {
      try {
        setUploading(true)
        const fd = new FormData()
        fd.append('file', avatarFile)
        const res = await api.post<{ success: true; data: { url: string } }>('/uploads/document', fd)
        newAvatarUrl = res.data.data.url
      } catch (err: any) {
        setError(err?.response?.data?.error?.message ?? 'Photo upload failed.')
        return
      } finally {
        setUploading(false)
      }
    }

    const dto: Parameters<typeof update.mutateAsync>[0] = { id: user.id }
    if (name.trim()        !== user.name)            dto.name     = name.trim()
    if (email.trim()       !== user.email)           dto.email    = email.trim().toLowerCase()
    if (role               !== (user.role === 'admin' ? 'admin' : 'instructor') as 'instructor' | 'admin') dto.role = role
    if (category           !== (user.category ?? '')) dto.category = (category || null) as '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | null
    if (headline.trim()    !== (user.headline ?? '')) dto.headline = headline.trim() || undefined
    if (bio.trim()         !== (user.bio ?? ''))      dto.bio      = bio.trim() || undefined
    if (newAvatarUrl)                                 dto.avatarUrl = newAvatarUrl
    /* Sent only when it actually changed. The server compares values rather
       than keys for exactly this reason, but an unchanged field on the wire is
       still a field somebody has to reason about when a save is refused. */
    if (canLend && shared !== (user.sharedAcrossOrgs === true)) dto.sharedAcrossOrgs = shared

    const hasChanges = Object.keys(dto).length > 1
    if (!hasChanges) { onClose(); return }

    try {
      await update.mutateAsync(dto)
      toast.success('Instructor updated')
      onSuccess()
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to save changes.')
    }
  }

  const base   = 'w-full rounded-xl py-2.5 pl-9 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/25'
  const iStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' } as React.CSSProperties
  const iFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.border    = '1px solid rgba(0,87,184,0.5)'
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.10)'
  }
  const iBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.border    = '1px solid rgba(255,255,255,0.09)'
    e.currentTarget.style.boxShadow = 'none'
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          onClick={e => e.stopPropagation()}
          className="flex w-full max-w-md flex-col rounded-2xl shadow-2xl"
          style={{ background: '#161829', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '90vh' }}
        >
          {/* Header */}
          <div className="flex flex-shrink-0 items-center justify-between gap-3 px-6 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ background: 'rgba(0,87,184,0.20)', border: '1px solid rgba(0,87,184,0.30)' }}>
                <GraduationCap size={17} style={{ color: '#60a5fa' }} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Edit Instructor</h2>
                <p className="mt-0.5 truncate text-xs" style={{ color: 'rgba(255,255,255,0.38)' }}>{user.email}</p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0">
              <X size={15} />
            </Button>
          </div>

          {/* Scrollable form */}
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="space-y-4 px-6 py-5">

              {/* Avatar */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <div
                    className="h-20 w-20 cursor-pointer overflow-hidden rounded-full transition-opacity hover:opacity-80 flex items-center justify-center"
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border: avatarPreview ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.12)',
                      boxShadow: avatarPreview ? '0 0 0 3px rgba(59,130,246,0.12)' : undefined,
                    }}
                    onClick={() => fileRef.current?.click()}
                  >
                    <AvatarImg src={avatarPreview} className="h-full w-full object-cover"
                      fallback={<User size={28} style={{ color: 'rgba(255,255,255,0.3)' }} />} />
                  </div>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:brightness-110"
                    style={{ background: '#0057b8', border: '2px solid #161829' }}>
                    <Camera size={11} className="text-white" />
                  </button>
                </div>
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.32)' }}>
                  {avatarPreview ? 'Click to change photo' : 'Upload profile photo'}
                </span>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setAvatarFile(f)
                    setAvatarPreview(URL.createObjectURL(f))
                  }} />
              </div>

              {/* Name */}
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.32)' }}>Full Name</label>
                <div className="relative">
                  <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'rgba(255,255,255,0.25)' }} />
                  <input value={name} onChange={e => setName(e.target.value)}
                    required minLength={2} maxLength={100} placeholder="Full name"
                    className={base} style={iStyle} onFocus={iFocus} onBlur={iBlur} />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.32)' }}>Email Address</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'rgba(255,255,255,0.25)' }} />
                  <input value={email} onChange={e => setEmail(e.target.value)}
                    type="email" required placeholder="email@example.com"
                    className={base} style={iStyle} onFocus={iFocus} onBlur={iBlur} />
                </div>
              </div>

              {/* Role toggle */}
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.32)' }}>Role</label>
                <div className="flex gap-1.5 rounded-xl p-1.5"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {(['instructor', 'admin'] as const).map(r => (
                    <button key={r} type="button"
                      onClick={() => {
                        setRole(r)
                        /* A shared non-instructor is not a state the system
                           has: the schema refuses it on save and the server
                           refuses this very PATCH with INVALID_SHARED_ROLE.
                           Clearing it here means switching to Admin saves in
                           one go instead of failing on a checkbox that the
                           next line removes from the screen. */
                        if (r !== 'instructor') setShared(false)
                      }}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all"
                      style={role === r
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
                      }>
                      {r === 'instructor' ? <GraduationCap size={12} /> : <ShieldCheck size={12} />}
                      {r === 'instructor' ? 'Instructor' : 'Admin'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Available to both academies.

                  Only for the roles the API accepts it from, only on an
                  instructor, and only for the academy that OWNS them — the
                  borrowing academy administers a lent instructor but does not
                  decide the lending, and the server answers BORROWED_INSTRUCTOR
                  if it tries. Anyone else sees the state without the switch,
                  because "shared" is worth knowing even where it cannot be
                  changed: it is why this instructor appears in a list the
                  reader did not expect. */}
              {role === 'instructor' && (mayShare || shared) && (
                <label
                  className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-colors ${canLend ? 'cursor-pointer' : 'cursor-default'}`}
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <input
                    type="checkbox"
                    checked={shared}
                    disabled={!canLend}
                    onChange={e => setShared(e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--color-primary,#0057B8)] disabled:opacity-40"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.88)' }}>
                      Available to both organizations
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {canLend
                        ? 'Both academies can see this instructor and schedule classes for them. This account still belongs to this academy.'
                        : 'Shared by the academy that owns this account. Only they can change it.'}
                    </span>
                  </span>
                </label>
              )}

              {/* Category chips */}
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.32)' }}>Program Category *</label>
                <div className="flex flex-wrap gap-2">
                  {CATS.map(({ value, label, color, Icon }) => {
                    const active = category === value
                    return (
                      <button key={value} type="button" onClick={() => { setCategory(value); setCategoryError(null) }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                        style={active
                          ? { background: `${color}18`, border: `1px solid ${color}45`, color }
                          : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.32)' }
                        }>
                        <Icon size={11} />{label}
                      </button>
                    )
                  })}
                </div>
                {categoryError && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
                    <AlertCircle size={10} />{categoryError}
                  </p>
                )}
              </div>

              {/* Headline */}
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.32)' }}>Headline</label>
                <div className="relative">
                  <FileText size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'rgba(255,255,255,0.25)' }} />
                  <input value={headline} onChange={e => setHeadline(e.target.value)}
                    maxLength={255} placeholder="e.g. Senior Trader & Educator"
                    className={base} style={iStyle} onFocus={iFocus} onBlur={iBlur} />
                </div>
              </div>

              {/* Bio */}
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.32)' }}>Bio</label>
                <textarea value={bio} onChange={e => setBio(e.target.value)}
                  rows={3} maxLength={2000} placeholder="Short instructor bio…"
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-all placeholder:text-white/25 resize-none"
                  style={iStyle} onFocus={iFocus} onBlur={iBlur} />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex-shrink-0 px-6 pb-5 pt-3"
              style={{ background: '#161829', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {error && (
                <p className="mb-3 flex items-center gap-1.5 text-xs" style={{ color: '#f87171' }}>
                  <AlertCircle size={11} />{error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <MotionButton
                  type="submit" variant="default" disabled={isPending}
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  {uploading
                    ? <><Spinner size={14} />Uploading…</>
                    : isPending
                    ? <><Spinner size={14} />Saving…</>
                    : 'Save changes'}
                </MotionButton>
              </div>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
