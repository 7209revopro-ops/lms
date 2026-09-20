'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, AlertCircle, User, Mail,
  Lock, Unlock, BookOpen, Plus, Trash2,
  ChevronDown, ChevronUp, FileText, ExternalLink,
  Phone, MapPin, CreditCard, ClipboardList, Camera,
  TrendingUp, Cpu, BarChart2,
} from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'
import {
  useUpdateUser, useStudentEnrollments, useUpdateEnrollmentAccess,
  useEnrollStudent, useRemoveEnrollment, type AdminUser,
} from '@/lib/api/users'
import { useCourseOutline } from '@/lib/api/outline'
import { useCourses } from '@/lib/api/courses'
import { useToast } from '@/store/ui.store'
import { Button, MotionButton } from '@/components/ui/button'
import { useDocumentUrl } from '@/lib/api/documents'
import { programLabel } from '@/lib/programs'
import { AvatarImg } from '@/components/ui/AvatarImg'

/* ── Custom dark course picker (avoids native white dropdown) ── */
function CourseSelect({
  value, onChange, courses, placeholder = 'Select a course to enroll…',
}: {
  value: string
  onChange: (v: string) => void
  courses: { id: string; title: string }[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = courses.find(c => c.id === value)

  return (
    <div ref={ref} className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs outline-none"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.09)',
          color: value ? 'white' : 'rgba(255,255,255,0.35)',
        }}
      >
        <span className="truncate">{selected?.title ?? placeholder}</span>
        <ChevronDown size={12} className="ml-2 flex-shrink-0 opacity-50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-xl py-1"
            style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}
          >
            {courses.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false) }}
                className="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.08]"
                style={{ color: c.id === value ? '#0057b8' : 'rgba(255,255,255,0.8)' }}
              >
                {c.title}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Module-access panel — section-level toggle ── */
function ModuleAccessPanel({
  courseId,
  blockedSections,
  onToggle,
  onBlockAll,
  onAllowAll,
}: {
  courseId:        string
  blockedSections: Set<string>
  onToggle:        (sectionId: string) => void
  onBlockAll:      (sectionIds: string[]) => void
  onAllowAll:      () => void
}) {
  const { data: outline, isLoading } = useCourseOutline(courseId)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
        <Spinner size={11} />Loading modules…
      </div>
    )
  }

  const sections = outline?.sections ?? []

  if (sections.length === 0) {
    return <p className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>No modules in this course.</p>
  }

  const allBlocked  = sections.every(s => blockedSections.has(s.id))
  const noneBlocked = sections.every(s => !blockedSections.has(s.id))

  return (
    <div className="px-3 pb-3 pt-2 space-y-1.5">
      {/* Select-all / deselect-all row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Modules
        </span>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={onAllowAll} disabled={noneBlocked}
            className="rounded-md px-2 py-0.5 text-[10px] font-semibold transition-all disabled:opacity-30 hover:brightness-110 h-auto"
            style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.25)' }}>
            Allow all
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onBlockAll(sections.map(s => s.id))} disabled={allBlocked}
            className="rounded-md px-2 py-0.5 text-[10px] font-semibold transition-all disabled:opacity-30 hover:brightness-110 h-auto"
            style={{ background: 'rgba(239,68,68,0.10)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.22)' }}>
            Block all
          </Button>
        </div>
      </div>

      {sections.map(section => {
        const isBlocked = blockedSections.has(section.id)
        return (
          <Button
            key={section.id}
            type="button"
            variant="ghost"
            onClick={() => onToggle(section.id)}
            className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-all hover:brightness-110 h-auto justify-start"
            style={{
              background: isBlocked ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.05)',
              border:     isBlocked ? '1px solid rgba(239,68,68,0.20)' : '1px solid rgba(16,185,129,0.15)',
            }}
          >
            {/* Checkbox */}
            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded"
              style={{
                background: isBlocked ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.12)',
                border:     isBlocked ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(16,185,129,0.35)',
              }}>
              {isBlocked
                ? <Lock   size={10} style={{ color: '#EF4444' }} />
                : <Unlock size={10} style={{ color: '#10B981' }} />}
            </div>

            <span className="flex-1 truncate font-medium"
              style={{ color: isBlocked ? '#F87171' : 'rgba(255,255,255,0.8)' }}>
              {section.title}
            </span>

            <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold"
              style={{
                background: isBlocked ? 'rgba(239,68,68,0.10)' : 'rgba(16,185,129,0.10)',
                color:      isBlocked ? '#EF4444' : '#10B981',
              }}>
              {isBlocked ? 'Blocked' : 'Allowed'}
            </span>
          </Button>
        )
      })}
    </div>
  )
}

/* ── Props ──────────────────────────────────────────── */
interface Props {
  user:      AdminUser
  onClose:   () => void
  onSuccess: () => void
}


/* Identity scans are stored as bare keys and exchanged for a short-lived
   signed link (H-11). Its own component so the hook has a stable home. */
function KycThumb({ userId, field, stored, label }: {
  userId: string; field: 'passport' | 'idDoc'; stored?: string; label: string
}) {
  const url = useDocumentUrl(userId, field, stored).url
  if (!stored) return null
  const isImage = /\.(jpg|jpeg|png|webp)$/i.test(stored)
  return (
    <div>
      <p className="mb-1 text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {isImage ? (
            <img src={url} alt={label} className="h-20 w-full rounded-lg object-cover transition-opacity hover:opacity-80"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }} />
          ) : (
            <span className="flex h-20 w-full items-center justify-center rounded-lg text-[10px]"
              style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>Open</span>
          )}
        </a>
      ) : (
        <span className="flex h-20 w-full items-center justify-center rounded-lg text-[10px]"
          style={{ border: '1px dashed rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)' }}>Loading…</span>
      )}
    </div>
  )
}

export function EditStudentModal({ user, onClose, onSuccess }: Props) {
  const update         = useUpdateUser()
  const updateAccess   = useUpdateEnrollmentAccess()
  const enrollStudent  = useEnrollStudent()
  const removeEnroll   = useRemoveEnrollment()
  const toast          = useToast()

  /* Profile fields */
  const [name,  setName]  = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [error, setError] = useState<string | null>(null)

  /* Categories — multi-select for students */
  const initCats = () => {
    const arr = user.categories && user.categories.length > 0
      ? user.categories
      : user.category ? [user.category] : []
    return new Set(arr)
  }
  const [categories,    setCategories]    = useState<Set<string>>(initCats)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  /* Photo upload */
  const [avatarFile,    setAvatarFile]    = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatarUrl ?? null)
  const [uploading,     setUploading]     = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  /* Course access — localBlocked stores SECTION IDs (not lesson IDs) */
  const { data: enrollments, isLoading: enrollmentsLoading, isError: enrollmentsError, error: enrollmentsErr } = useStudentEnrollments(user.id)
  const [localBlocked, setLocalBlocked] = useState<Record<string, Set<string>>>({})
  const [expandedEnrollments, setExpandedEnrollments] = useState<Set<string>>(new Set())

  /* All courses for the "add" picker */
  const { data: coursesData } = useCourses({ per_page: 200 })
  const allCourses = coursesData?.docs ?? []
  const [addCourseId, setAddCourseId] = useState('')

  /* Seed localBlocked once enrollments load */
  useEffect(() => {
    if (!enrollments) return
    setLocalBlocked(prev => {
      const next = { ...prev }
      enrollments.forEach(e => {
        const eid = String((e as any)._id ?? e.id)
        if (!(eid in next)) next[eid] = new Set(e.blockedLessons)
      })
      return next
    })
  }, [enrollments])

  /* Courses the student is NOT yet enrolled in */
  const enrolledCourseIds = new Set((enrollments ?? []).map(e => e.courseId?.id))
  const unenrolledCourses = allCourses.filter(c => !enrolledCourseIds.has(c.id))

  const [appOpen, setAppOpen] = useState(false)

  /* Toggle expand/collapse for an enrollment card */
  const toggleExpand = useCallback((eid: string) => {
    setExpandedEnrollments(prev => {
      const next = new Set(prev)
      if (next.has(eid)) next.delete(eid)
      else next.add(eid)
      return next
    })
  }, [])

  /* Toggle a single section for an enrollment */
  const toggleSection = useCallback((enrollmentId: string, sectionId: string) => {
    setLocalBlocked(prev => {
      const current = new Set(prev[enrollmentId] ?? [])
      if (current.has(sectionId)) current.delete(sectionId)
      else current.add(sectionId)
      return { ...prev, [enrollmentId]: current }
    })
  }, [])

  /* Block all sections for an enrollment */
  const blockAll = useCallback((enrollmentId: string, sectionIds: string[]) => {
    setLocalBlocked(prev => ({ ...prev, [enrollmentId]: new Set(sectionIds) }))
  }, [])

  /* Allow all sections for an enrollment */
  const allowAll = useCallback((enrollmentId: string) => {
    setLocalBlocked(prev => ({ ...prev, [enrollmentId]: new Set() }))
  }, [])

  /* Enroll in a new course */
  const handleEnroll = async () => {
    if (!addCourseId) return
    try {
      await enrollStudent.mutateAsync({ userId: user.id, courseId: addCourseId })
      setAddCourseId('')
      toast.success('Student enrolled!')
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message ?? 'Could not enroll student.')
    }
  }

  /* Remove an enrollment */
  const handleRemove = async (enrollmentId: string) => {
    try {
      await removeEnroll.mutateAsync({ enrollmentId, userId: user.id })
      toast.success('Enrollment removed.')
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message ?? 'Could not remove enrollment.')
    }
  }

  /* Submit — profile + any changed module-access */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (categories.size === 0) { setCategoryError('Please select at least one program category'); return }
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
        setUploading(false)
        setError(err?.response?.data?.error?.message ?? 'Photo upload failed.')
        return
      } finally {
        setUploading(false)
      }
    }

    const promises: Promise<unknown>[] = []

    const dto: { name?: string; email?: string; avatarUrl?: string; categories?: ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[] } = {}
    if (name.trim()  !== user.name)  dto.name  = name.trim()
    if (email.trim() !== user.email) dto.email = email.trim().toLowerCase()
    if (newAvatarUrl)                dto.avatarUrl = newAvatarUrl
    /* Compare categories */
    const origCats: Set<string> = initCats()
    const catsChanged = categories.size !== origCats.size || [...categories].some(c => !origCats.has(c))
    if (catsChanged) dto.categories = Array.from(categories) as ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]
    if (Object.keys(dto).length > 0) promises.push(update.mutateAsync({ id: user.id, ...dto }))

    enrollments?.forEach(e => {
      const eid      = String((e as any)._id ?? e.id)
      const original = new Set(e.blockedLessons)
      const current  = localBlocked[eid] ?? original
      const changed  = current.size !== original.size || [...current].some(id => !original.has(id))
      if (changed) {
        promises.push(updateAccess.mutateAsync({ id: eid, blockedLessons: Array.from(current) }))
      }
    })

    if (promises.length === 0) { onClose(); return }

    try {
      await Promise.all(promises)
      toast.success('Student updated')
      onSuccess()
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to save changes.')
    }
  }

  const isPending = update.isPending || updateAccess.isPending || uploading

  const base   = 'w-full rounded-xl py-2.5 pl-9 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/30'
  const iStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' } as React.CSSProperties
  const iFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.border    = '1px solid rgba(0,87,184,0.5)'
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.10)'
  }
  const iBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.border    = '1px solid rgba(255,255,255,0.09)'
    e.currentTarget.style.boxShadow = 'none'
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.65)' }}
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
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                Edit Student
              </h2>
              <p className="mt-0.5 truncate text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.email}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="flex-shrink-0"
            >
              <X size={15} />
            </Button>
          </div>

          {/* Scrollable body */}
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="space-y-3 px-6 py-4">
              {/* Profile photo */}
              <div className="flex flex-col items-center gap-2 pb-1">
                <div className="relative">
                  <div
                    className="h-20 w-20 overflow-hidden rounded-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.12)' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <AvatarImg src={avatarPreview} className="h-full w-full object-cover"
                      fallback={<User size={28} style={{ color: 'rgba(255,255,255,0.3)' }} />} />
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:brightness-110"
                    style={{ background: '#0057b8', border: '2px solid #161829' }}
                  >
                    <Camera size={11} className="text-white" />
                  </button>
                </div>
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {avatarPreview ? 'Click to change photo' : 'Upload profile photo'}
                </span>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>

              {/* Name */}
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.35)' }}>Full name</label>
                <div className="relative">
                  <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'rgba(255,255,255,0.35)' }} />
                  <input value={name} onChange={e => setName(e.target.value)}
                    required minLength={2} maxLength={100} placeholder="Full name"
                    className={base} style={iStyle} onFocus={iFocus} onBlur={iBlur} />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.35)' }}>Email address</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'rgba(255,255,255,0.35)' }} />
                  <input value={email} onChange={e => setEmail(e.target.value)}
                    type="email" required placeholder="email@example.com"
                    className={base} style={iStyle} onFocus={iFocus} onBlur={iBlur} />
                </div>
              </div>

              {/* Categories — multi-select */}
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.35)' }}>Program Categories *</label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: '4x-trading',        label: 'FOREX Trading',     color: '#fb923c', Icon: TrendingUp },
                    { value: 'jura',              label: 'JURA',              color: '#8B5CF6', Icon: TrendingUp },
                    { value: 'digital-marketing', label: 'Digital Marketing', color: '#60a5fa', Icon: BarChart2 },
                    { value: 'ai',                label: 'AI',                color: '#c084fc', Icon: Cpu },
                  ] as const).map(({ value, label, color, Icon }) => {
                    const active = categories.has(value)
                    return (
                      <button key={value} type="button"
                        onClick={() => {
                          setCategoryError(null)
                          setCategories(prev => {
                            const next = new Set(prev)
                            if (next.has(value)) next.delete(value)
                            else next.add(value)
                            return next
                          })
                        }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                        style={active
                          ? { background: `${color}18`, border: `1px solid ${color}45`, color }
                          : categoryError
                          ? { background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', color: 'rgba(255,255,255,0.32)' }
                          : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.32)' }
                        }>
                        <Icon size={11} />{label}
                      </button>
                    )
                  })}
                </div>
                {categoryError && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
                    <AlertCircle size={11} />{categoryError}
                  </p>
                )}
              </div>
            </div>

            {/* Enrollment Application section */}
            {user.enrollmentApplication && (
              <div className="px-6 pb-2">
                <button
                  type="button"
                  onClick={() => setAppOpen(v => !v)}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <div className="flex items-center gap-2">
                    <ClipboardList size={13} style={{ color: '#0057b8' }} />
                    <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      Enrollment Application
                    </span>
                  </div>
                  {appOpen ? <ChevronUp size={13} style={{ color: 'rgba(255,255,255,0.35)' }} /> : <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.35)' }} />}
                </button>

                <AnimatePresence>
                  {appOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      {(() => {
                        const app = user.enrollmentApplication!
                        function Row({ label, value }: { label: string; value?: string | null }) {
                          if (!value) return null
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.25)' }}>{label}</span>
                              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>{value}</span>
                            </div>
                          )
                        }
                        return (
                          <div className="mt-2 space-y-3 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            {/* Personal */}
                            <div>
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <User size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Personal</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <Row label="Phone" value={app.phone} />
                                <Row label="Emergency Contact" value={app.emergencyContact} />
                                <Row label="Gender" value={app.gender} />
                                <Row label="Date of Birth" value={app.dateOfBirth} />
                                <Row label="Nationality" value={app.nationality} />
                                <Row label="Home Country" value={app.homeCountry} />
                                <Row label="Occupation" value={app.occupation} />
                                {(app.idType || app.idNumber) ? (
                                  <>
                                    <Row label="ID Type"   value={app.idType} />
                                    <Row label="ID Number" value={app.idNumber} />
                                  </>
                                ) : (
                                  <Row label="Emirates ID" value={app.emiratesId} />
                                )}
                              </div>
                            </div>
                            {/* Address */}
                            <div>
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <MapPin size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Address</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <Row label="Country of Attendance" value={app.countryAttendance} />
                                <Row label="Villa / Apartment" value={app.villa} />
                                <Row label="City" value={app.city} />
                                <Row label="Country" value={app.addressCountry} />
                              </div>
                            </div>
                            {/* Program */}
                            <div>
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <BookOpen size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Program</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <Row label="Experience Level" value={app.experienceLevel} />
                                <Row label="Start Date" value={app.preferredStartDate} />
                                <Row label="How Heard" value={app.hearAboutUs} />
                                {app.referralName && <Row label="Referral" value={app.referralName} />}
                                {app.programs && app.programs.length > 0 && (
                                  <div className="col-span-2 flex flex-col gap-0.5">
                                    <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.25)' }}>Programs</span>
                                    <div className="flex flex-wrap gap-1 mt-0.5">
                                      {app.programs.map(p => (
                                        <span key={p} className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                          style={{ background: 'rgba(0,87,184,0.12)', color: '#0057b8' }}>
                                          {programLabel(p)}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Payment */}
                            {app.paymentMethod && (
                              <div>
                                <div className="mb-1.5 flex items-center gap-1.5">
                                  <CreditCard size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                  <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Payment</span>
                                </div>
                                <Row label="Payment Method" value={app.paymentMethod} />
                              </div>
                            )}
                            {/* Documents */}
                            {(app.passportUrl || app.idDocUrl || app.photoUrl) && (
                              <div>
                                <div className="mb-1.5 flex items-center gap-1.5">
                                  <FileText size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                  <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Documents</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <KycThumb userId={user.id} field="passport" stored={app.passportUrl} label="Passport" />
                                  <KycThumb userId={user.id} field="idDoc" stored={app.idDocUrl} label={app.idType ?? 'ID Document'} />
                                  {app.photoUrl && (
                                    <div>
                                      <span className="text-[9px] font-semibold uppercase tracking-wide block mb-1" style={{ color: 'rgba(255,255,255,0.25)' }}>Photo</span>
                                      <a href={app.photoUrl} target="_blank" rel="noopener noreferrer">
                                        <img src={app.photoUrl} alt="Photo" className="h-20 w-full rounded-lg object-cover hover:opacity-80 transition-opacity"
                                          style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
                                      </a>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Course access section */}
            <div className="px-6 pb-4">
              {/* Section header */}
              <div className="mb-3 flex items-center gap-2">
                <BookOpen size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
                <p className="text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.35)' }}>Course Access</p>
              </div>

              {/* Add-course row */}
              {unenrolledCourses.length > 0 && (
                <div className="mb-3 flex items-center gap-2">
                  <CourseSelect
                    value={addCourseId}
                    onChange={setAddCourseId}
                    courses={unenrolledCourses}
                  />
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleEnroll}
                    disabled={!addCourseId || enrollStudent.isPending}
                    className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-white disabled:opacity-40 transition-all hover:brightness-110 h-auto"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {enrollStudent.isPending
                      ? <Spinner size={11} />
                      : <Plus size={11} />}
                    Enroll
                  </Button>
                </div>
              )}

              {/* Enrollment list */}
              {enrollmentsLoading ? (
                <div className="flex items-center gap-2 py-4 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  <Spinner size={13} />Loading enrollments…
                </div>
              ) : enrollmentsError ? (
                <p className="flex items-center gap-1.5 py-3 text-xs" style={{ color: '#F87171' }}>
                  <AlertCircle size={11} />
                  {(enrollmentsErr as any)?.response?.data?.error?.message ?? 'Could not load enrollments.'}
                </p>
              ) : !enrollments || enrollments.length === 0 ? (
                <p className="py-3 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Not enrolled in any courses yet. Use the selector above to add one.
                </p>
              ) : (
                <div className="space-y-2">
                  {enrollments.map(enrollment => {
                    const eid            = String((enrollment as any)._id ?? enrollment.id)
                    const blockedSections = localBlocked[eid] ?? new Set<string>()
                    const hasRestrict    = blockedSections.size > 0
                    const courseId       = String((enrollment.courseId as any)?._id ?? enrollment.courseId?.id ?? '')
                    const isExpanded     = expandedEnrollments.has(eid)

                    return (
                      <motion.div
                        key={eid}
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                        className="overflow-hidden rounded-xl transition-all"
                        style={{
                          border:     '1.5px solid rgba(255,255,255,0.08)',
                          background: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        {/* Course header row */}
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          {/* Thumbnail */}
                          <div className="h-8 w-12 flex-shrink-0 overflow-hidden rounded-lg"
                            style={{ background: 'rgba(255,255,255,0.08)' }}>
                            {enrollment.courseId?.thumbnailUrl && (
                              <img src={enrollment.courseId.thumbnailUrl} alt=""
                                className="h-full w-full object-cover" />
                            )}
                          </div>

                          {/* Title + badge */}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-white">
                              {enrollment.courseId?.title ?? '—'}
                            </p>
                            <p className="text-[10px]" style={{ color: hasRestrict ? '#F87171' : 'rgba(255,255,255,0.35)' }}>
                              {hasRestrict ? `${blockedSections.size} module${blockedSections.size !== 1 ? 's' : ''} blocked` : 'Full access'}
                            </p>
                          </div>

                          {/* Expand toggle */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => toggleExpand(eid)}
                            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                            style={{ color: 'rgba(255,255,255,0.4)' }}
                            title="Toggle module access"
                          >
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </Button>

                          {/* Remove enrollment */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemove(eid)}
                            disabled={removeEnroll.isPending}
                            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-red-500/15 disabled:opacity-40"
                            style={{ color: 'rgba(255,255,255,0.3)' }}
                            title="Remove enrollment"
                          >
                            {removeEnroll.isPending
                              ? <Spinner size={11} />
                              : <Trash2 size={11} />}
                          </Button>
                        </div>

                        {/* Module access panel — collapsible */}
                        <AnimatePresence>
                          {isExpanded && courseId && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              style={{ overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.06)' }}
                            >
                              <ModuleAccessPanel
                                courseId={courseId}
                                blockedSections={blockedSections}
                                onToggle={sectionId => toggleSection(eid, sectionId)}
                                onBlockAll={sectionIds => blockAll(eid, sectionIds)}
                                onAllowAll={() => allowAll(eid)}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex-shrink-0 px-6 pb-5 pt-3"
              style={{ background: '#161829', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {error && (
                <p className="mb-3 flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
                  <AlertCircle size={11} />{error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <MotionButton
                  type="submit"
                  variant="default"
                  disabled={isPending}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
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
