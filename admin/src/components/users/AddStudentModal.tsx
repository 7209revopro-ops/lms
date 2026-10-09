'use client'

import { useState, useCallback, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, User, Mail, Lock, Eye, EyeOff, AlertCircle,
  CheckCircle2, Users, ChevronDown, ChevronUp,
  Check, Unlock, ArrowLeft, ArrowRight,
  TrendingUp, Cpu, BarChart2, Tag, Building2,
} from 'lucide-react'
import { useCreateInstructor } from '@/lib/api/instructors'
import Spinner from '@/components/ui/Spinner'
import { useCourses } from '@/lib/api/courses'
import { useOrganizations } from '@/lib/api/organizations'
import { useCurrentUser } from '@/lib/api/user'
import { useOrgStore } from '@/store/org.store'
import { useCourseOutline } from '@/lib/api/outline'
import { useBackdropClose } from '@/hooks/useBackdropClose'

/* ── Types ──────────────────────────────────────────------ */
interface CourseState {
  blockedLessons: Set<string>
  expanded: boolean
}

interface BlockState {
  [courseId: string]: CourseState
}

const CATS = [
  { value: '4x-trading',        label: 'FOREX Trading',     color: '#fb923c', Icon: TrendingUp },
  { value: 'jura',              label: 'JURA',              color: '#8B5CF6', Icon: TrendingUp },
  { value: 'digital-marketing', label: 'Digital Marketing', color: '#60a5fa', Icon: BarChart2 },
  { value: 'ai',                label: 'AI',                color: '#c084fc', Icon: Cpu },
] as const

/* ── Zod schema for step 1 ─────────────────────────── */
const accountSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters').max(100),
  email:    z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
type AccountValues = z.infer<typeof accountSchema>

/* ── Reusable Field wrapper ────────────────────────── */
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold"
        style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-1 flex items-center gap-1 text-xs" style={{ color: '#F87171' }}>
            <AlertCircle size={10} />{error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

const inputCls = 'w-full rounded-xl py-2.5 pl-9 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/30'

const inputStyle = (hasError?: boolean): React.CSSProperties =>
  hasError
    ? { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }
    : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }

/* ── Course outline sub-component — section-level toggle ── */
function CourseOutlinePanel({
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
      <div className="flex items-center gap-2 py-3 px-4 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
        <Spinner size={11} />Loading modules…
      </div>
    )
  }

  const sections = outline?.sections ?? []

  if (sections.length === 0) {
    return <p className="py-3 px-4 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>No modules added yet.</p>
  }

  const allBlocked  = sections.every(s => blockedSections.has(s.id))
  const noneBlocked = sections.every(s => !blockedSections.has(s.id))

  return (
    <div className="px-3 pb-3 pt-2 space-y-1.5">
      {/* Allow all / Block all */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Module access
        </span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onAllowAll} disabled={noneBlocked}
            className="rounded-md px-2 py-0.5 text-[10px] font-semibold transition-all disabled:opacity-30 hover:brightness-110"
            style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.25)' }}>
            Allow all
          </button>
          <button type="button" onClick={() => onBlockAll(sections.map(s => s.id))} disabled={allBlocked}
            className="rounded-md px-2 py-0.5 text-[10px] font-semibold transition-all disabled:opacity-30 hover:brightness-110"
            style={{ background: 'rgba(239,68,68,0.10)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.22)' }}>
            Block all
          </button>
        </div>
      </div>

      {sections.map(section => {
        const isBlocked = blockedSections.has(section.id)
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onToggle(section.id)}
            className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-all hover:brightness-110"
            style={{
              background: isBlocked ? 'rgba(239,68,68,0.07)' : 'rgba(16,185,129,0.05)',
              border:     isBlocked ? '1px solid rgba(239,68,68,0.20)' : '1px solid rgba(16,185,129,0.15)',
            }}
          >
            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded"
              style={{
                background: isBlocked ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.12)',
                border:     isBlocked ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(16,185,129,0.35)',
              }}>
              {isBlocked
                ? <Lock size={10} style={{ color: '#EF4444' }} />
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
          </button>
        )
      })}
    </div>
  )
}

/* ── Main modal ────────────────────────────────────── */
interface Props {
  open:    boolean
  onClose: () => void
}

export function AddStudentModal({ open, onClose }: Props) {
  const [step, setStep]             = useState<1 | 2>(1)
  const [showPw, setShowPw]         = useState(false)
  const [success, setSuccess]       = useState(false)
  const [blockState, setBlockState] = useState<BlockState>({})
  const [accountValues, setAccountValues] = useState<AccountValues | null>(null)
  const [categories, setCategories] = useState<Set<string>>(new Set())
  const [categoryError, setCategoryError] = useState<string | null>(null)

  /* ── Which academy? ───────────────────────────────────────────────────
     Only a super admin chooses. Everyone else's account is created in their
     own academy by the server, so showing them a picker would offer a choice
     they do not have. A super admin's topbar switcher supplies the default,
     but its default position is "All Orgs" — which is no academy at all, and
     is exactly how accounts belonging to nobody used to be created. So it is
     a required field, not an inherited one. */
  const { data: me } = useCurrentUser()
  const isSuper = me?.role === 'super_admin'
  const activeOrgId = useOrgStore(s => s.activeOrgId)
  const { data: orgs } = useOrganizations(isSuper)
  const [orgId, setOrgId] = useState<string>('')
  const [orgError, setOrgError] = useState<string | null>(null)

  /* Follow the switcher when it points at a single academy. */
  useEffect(() => {
    if (isSuper && activeOrgId && !orgId) setOrgId(activeOrgId)
  }, [isSuper, activeOrgId, orgId])

  const { mutateAsync, isPending, error: apiError } = useCreateInstructor()
  const { data: coursesData, isLoading: coursesLoading } = useCourses({ per_page: 50, status: 'published' })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
  })

  const serverError = (() => {
    if (!apiError) return null
    const e = apiError as { response?: { data?: { error?: { message?: string } } } }
    return e.response?.data?.error?.message ?? 'Failed to create student. Please try again.'
  })()

  /* Step 1 → Step 2 */
  const onStep1Submit = (values: AccountValues) => {
    if (isSuper && !orgId) { setOrgError('Select which academy this student belongs to'); return }
    setOrgError(null)
    if (categories.size === 0) { setCategoryError('Please select at least one program category'); return }
    setCategoryError(null)
    setAccountValues(values)
    setStep(2)
  }

  /* Toggle course selection */
  const toggleCourse = useCallback((courseId: string) => {
    setBlockState(prev => {
      const existing = prev[courseId]
      if (existing) {
        const { [courseId]: _, ...rest } = prev
        return rest
      }
      return {
        ...prev,
        [courseId]: { blockedLessons: new Set(), expanded: true },
      }
    })
  }, [])

  /* Toggle a single section blocked/allowed */
  const toggleSection = useCallback((courseId: string, sectionId: string) => {
    setBlockState(prev => {
      const course = prev[courseId]
      if (!course) return prev
      const next = new Set(course.blockedLessons)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return { ...prev, [courseId]: { ...course, blockedLessons: next } }
    })
  }, [])

  /* Block all sections in a course */
  const blockAll = useCallback((courseId: string, sectionIds: string[]) => {
    setBlockState(prev => {
      const course = prev[courseId]
      if (!course) return prev
      return { ...prev, [courseId]: { ...course, blockedLessons: new Set(sectionIds) } }
    })
  }, [])

  /* Allow all sections in a course */
  const allowAll = useCallback((courseId: string) => {
    setBlockState(prev => {
      const course = prev[courseId]
      if (!course) return prev
      return { ...prev, [courseId]: { ...course, blockedLessons: new Set() } }
    })
  }, [])

  /* Toggle course outline expanded state */
  const toggleExpand = useCallback((courseId: string) => {
    setBlockState(prev => {
      const course = prev[courseId]
      if (!course) return prev
      return { ...prev, [courseId]: { ...course, expanded: !course.expanded } }
    })
  }, [])

  /* Final submission */
  const onFinalSubmit = async () => {
    if (!accountValues) return
    const courses = Object.entries(blockState)
      .map(([courseId, v]) => ({
        courseId,
        blockedLessons: Array.from(v.blockedLessons),
      }))

    await mutateAsync({
      name:       accountValues.name,
      email:      accountValues.email,
      password:   accountValues.password,
      role:       'student',
      categories: Array.from(categories) as ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[],
      courses,
      ...(isSuper && orgId ? { organizationId: orgId } : {}),
    })
    setSuccess(true)
    setTimeout(() => {
      setSuccess(false)
      reset()
      setStep(1)
      setBlockState({})
      setAccountValues(null)
      setCategories(new Set())
      setOrgId('')
      setOrgError(null)
      onClose()
    }, 1800)
  }

  const handleClose = () => {
    if (isPending) return
    reset()
    setStep(1)
    setBlockState({})
    setAccountValues(null)
    setCategories(new Set())
    setCategoryError(null)
    setOrgId('')
    setOrgError(null)
    setSuccess(false)
    onClose()
  }
  const backdrop = useBackdropClose(handleClose)

  const selectedCourseIds = Object.keys(blockState)

  return (
    <AnimatePresence>
      {open && (
          <motion.div key="add-student-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            {...backdrop}>

          <motion.div key="add-student-modal"
            initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="overflow-hidden rounded-2xl shadow-2xl"
            style={{
              background: '#161829',
              border: '1px solid rgba(255,255,255,0.10)',
              width: '100%',
              maxWidth: step === 2 ? 580 : 448,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={e => e.stopPropagation()}>

            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ background: 'rgba(47,107,255,0.15)', border: '1px solid rgba(47,107,255,0.25)' }}>
                <Users size={18} style={{ color: '#5B8FFF' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">Add Student</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {step === 1 ? 'Step 1 of 2 — Account info' : 'Step 2 of 2 — Course access'}
                </p>
              </div>
              {/* Step indicators */}
              <div className="flex items-center gap-1.5 mr-2">
                {[1, 2].map(s => (
                  <div key={s} className="h-1.5 w-6 rounded-full transition-colors"
                    style={{ background: s <= step ? '#2F6BFF' : 'rgba(255,255,255,0.15)' }} />
                ))}
              </div>
              <button onClick={handleClose}
                className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={15} />
              </button>
            </div>

            {/* ── Success ── */}
            <AnimatePresence>
              {success && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-3 px-6 py-10">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full"
                    style={{ background: 'rgba(14,204,142,0.12)', border: '1px solid rgba(14,204,142,0.25)' }}>
                    <CheckCircle2 size={28} style={{ color: '#0ECC8E' }} />
                  </div>
                  <p className="text-sm font-semibold text-white">Student created!</p>
                  <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {selectedCourseIds.length > 0
                      ? `Enrolled in ${selectedCourseIds.length} course${selectedCourseIds.length > 1 ? 's' : ''}.`
                      : 'They can now log in and browse courses.'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {!success && (
              <div className="flex-1 overflow-y-auto min-h-0">
                {/* ── Step 1: Account info ── */}
                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <motion.form
                      key="step1"
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      onSubmit={handleSubmit(onStep1Submit)}
                      className="px-6 py-5 space-y-4"
                    >
                      <Field label="Full name *" error={errors.name?.message}>
                        <div className="relative">
                          <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                          <input {...register('name')} placeholder="e.g. John Smith"
                            className={inputCls} style={inputStyle(!!errors.name)} />
                        </div>
                      </Field>

                      {/* Academy — super admins only. Everyone else's account
                          is created in their own, so there is nothing to ask. */}
                      {isSuper && (
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold"
                            style={{ color: 'rgba(255,255,255,0.5)' }}>
                            Academy * <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>(which one this student belongs to)</span>
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {(orgs ?? []).map(o => {
                              const active = orgId === o.id
                              return (
                                <button key={o.id} type="button"
                                  onClick={() => { setOrgError(null); setOrgId(o.id) }}
                                  className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                                  style={active
                                    ? { background: 'rgba(47,107,255,0.14)', border: '1px solid rgba(47,107,255,0.45)', color: '#7FA8FF' }
                                    : orgError
                                    ? { background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', color: 'rgba(255,255,255,0.32)' }
                                    : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.32)' }
                                  }>
                                  <Building2 size={11} />{o.name}
                                </button>
                              )
                            })}
                            {(orgs ?? []).length === 0 && (
                              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                                Loading academies…
                              </span>
                            )}
                          </div>
                          <AnimatePresence>
                            {orgError && (
                              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: '#F87171' }}>
                                <AlertCircle size={10} />{orgError}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </div>
                      )}

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold"
                          style={{ color: 'rgba(255,255,255,0.5)' }}>Program Category * <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>(select all that apply)</span></label>
                        <div className="flex flex-wrap gap-2">
                          {CATS.map(({ value, label, color, Icon }) => {
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
                        <AnimatePresence>
                          {categoryError && (
                            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                              className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: '#F87171' }}>
                              <AlertCircle size={10} />{categoryError}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>

                      <Field label="Email address *" error={errors.email?.message}>
                        <div className="relative">
                          <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                          <input {...register('email')} type="email" placeholder="john@example.com"
                            className={inputCls} style={inputStyle(!!errors.email)} />
                        </div>
                      </Field>

                      <Field label="Password *" error={errors.password?.message}>
                        <div className="relative">
                          <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                          <input {...register('password')} type={showPw ? 'text' : 'password'}
                            placeholder="Min. 8 characters"
                            className={`${inputCls} pr-9`} style={inputStyle(!!errors.password)} />
                          <button type="button" onClick={() => setShowPw(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                            style={{ color: 'rgba(255,255,255,0.4)' }}>
                            {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      </Field>

                      <div className="flex items-center justify-end gap-3 pt-1">
                        <button type="button" onClick={handleClose}
                          className="rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/10"
                          style={{ color: 'rgba(255,255,255,0.5)' }}>
                          Cancel
                        </button>
                        <motion.button type="submit"
                          whileHover={{ y: -1, boxShadow: '0 6px 20px rgba(47,107,255,0.28)' }}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
                          style={{ background: 'linear-gradient(135deg, #2F6BFF, #5B8FFF)' }}>
                          Next <ArrowRight size={14} />
                        </motion.button>
                      </div>
                    </motion.form>
                  )}

                  {/* ── Step 2: Course selection ── */}
                  {step === 2 && (
                    <motion.div
                      key="step2"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="px-6 py-5"
                    >
                      {/* Server error */}
                      <AnimatePresence>
                        {serverError && (
                          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className="mb-4 flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs"
                            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#DC2626' }}>
                            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />{serverError}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <p className="mb-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        Select which courses to enroll this student in. Expand a course to block access to specific modules.
                      </p>

                      {coursesLoading ? (
                        <div className="flex items-center gap-2 py-6 justify-center text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          <Spinner size={14} />Loading courses…
                        </div>
                      ) : (coursesData?.docs.length ?? 0) === 0 ? (
                        <p className="py-6 text-center text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          No published courses available.
                        </p>
                      ) : (
                        <div className="space-y-2 mb-4">
                          {coursesData?.docs.map(course => {
                            const state = blockState[course.id]
                            const isSelected = !!state
                            const hasRestrictions = (state?.blockedLessons.size ?? 0) > 0

                            return (
                              <div key={course.id}
                                className="rounded-xl overflow-hidden transition-all"
                                style={{
                                  border: isSelected ? '1.5px solid rgba(47,107,255,0.60)' : '1.5px solid rgba(255,255,255,0.08)',
                                  background: isSelected ? 'rgba(47,107,255,0.08)' : 'rgba(255,255,255,0.03)',
                                }}>
                                {/* Course row */}
                                <div className="flex items-center gap-3 px-3 py-2.5">
                                  {/* Checkbox */}
                                  <button
                                    type="button"
                                    onClick={() => toggleCourse(course.id)}
                                    className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded transition-all"
                                    style={{
                                      background: isSelected ? '#2F6BFF' : 'rgba(255,255,255,0.06)',
                                      border: isSelected ? '1.5px solid #2F6BFF' : '1.5px solid rgba(255,255,255,0.18)',
                                    }}
                                  >
                                    {isSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                                  </button>

                                  {/* Thumbnail */}
                                  <div className="h-8 w-12 flex-shrink-0 overflow-hidden rounded-lg"
                                    style={{ background: 'rgba(255,255,255,0.08)' }}>
                                    {course.thumbnailUrl && (
                                      <img src={course.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                                    )}
                                  </div>

                                  {/* Info */}
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-semibold text-white">
                                      {course.title}
                                      {/* Same-name courses exist per academy — say whose, and flag
                                          one outside the academy this student is being created in. */}
                                      {isSuper && course.organizationId && (
                                        <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'rgba(255,255,255,0.45)' }}>
                                          · {orgs?.find(o => o.id === course.organizationId)?.name ?? ''}
                                        </span>
                                      )}
                                      {isSuper && orgId && course.organizationId && course.organizationId !== orgId && (
                                        <span className="ml-1.5 text-[10px] font-semibold" style={{ color: '#F59E0B' }}>other academy</span>
                                      )}
                                    </p>
                                    {hasRestrictions && (
                                      <p className="text-[10px]" style={{ color: '#F87171' }}>
                                        Some modules blocked
                                      </p>
                                    )}
                                  </div>

                                  {/* Expand toggle — only when selected */}
                                  {isSelected && (
                                    <button
                                      type="button"
                                      onClick={() => toggleExpand(course.id)}
                                      className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                                      style={{ color: 'rgba(255,255,255,0.4)' }}
                                      title="Toggle curriculum"
                                    >
                                      {state.expanded
                                        ? <ChevronUp size={13} />
                                        : <ChevronDown size={13} />}
                                    </button>
                                  )}
                                </div>

                                {/* Curriculum panel */}
                                <AnimatePresence>
                                  {isSelected && state.expanded && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2 }}
                                      style={{ overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.08)' }}
                                    >
                                      <CourseOutlinePanel
                                        courseId={course.id}
                                        blockedSections={state.blockedLessons}
                                        onToggle={(sectionId) => toggleSection(course.id, sectionId)}
                                        onBlockAll={(sectionIds) => blockAll(course.id, sectionIds)}
                                        onAllowAll={() => allowAll(course.id)}
                                      />
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between gap-3 pt-2 sticky bottom-0 pb-1"
                        style={{ background: '#161829' }}>
                        <button type="button" onClick={() => setStep(1)}
                          className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/10"
                          style={{ color: 'rgba(255,255,255,0.5)' }}>
                          <ArrowLeft size={14} /> Back
                        </button>
                        <div className="flex items-center gap-3">
                          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                            {selectedCourseIds.length === 0
                              ? 'No courses selected'
                              : `${selectedCourseIds.length} course${selectedCourseIds.length > 1 ? 's' : ''} selected`}
                          </span>
                          <motion.button
                            type="button"
                            onClick={onFinalSubmit}
                            disabled={isPending}
                            whileHover={{ y: -1, boxShadow: '0 6px 20px rgba(47,107,255,0.28)' }}
                            whileTap={{ scale: 0.98 }}
                            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
                            style={{ background: 'linear-gradient(135deg, #2F6BFF, #5B8FFF)' }}>
                            {isPending
                              ? <><Spinner size={14} />Creating…</>
                              : <>Create Student</>}
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
          </motion.div>
      )}
    </AnimatePresence>
  )
}
