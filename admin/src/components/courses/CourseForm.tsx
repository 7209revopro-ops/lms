'use client'

import { useState, useEffect, useRef } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  BookOpen, DollarSign, Settings, Tag, Image, Link as LinkIcon,
  ArrowLeft, Check, AlertCircle, ChevronDown, Layers,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCreateCourse, useUpdateCourse } from '@/lib/api/courses'
import { useCategories } from '@/lib/api/categories'
import { useOrganizations } from '@/lib/api/organizations'
import { useCurrentUser } from '@/lib/api/user'
import { useOrgStore } from '@/store/org.store'
import { useToast } from '@/store/ui.store'
import { MediaUploadField } from '@/components/ui/MediaUploadField'
import { courseLanguageOptions } from '@/lib/languages'
import type { Course, CourseFormValues } from '@/types/index'
import Spinner from '@/components/ui/Spinner'

/* Lazy-loaded so it gets its own webpack chunk and doesn't bloat the form chunk */
const ModulesSection = dynamic(
  () => import('@/components/courses/ModulesSection').then(m => ({ default: m.ModulesSection })),
  { ssr: false },
)

/* ── Zod schema ─────────────────────────────────────────────── */
const schema = z.object({
  title:        z.string().min(3, 'Title must be at least 3 characters'),
  slug:         z.string().min(2, 'Slug required').regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  description:  z.string().min(20, 'Description must be at least 20 characters'),
  thumbnailUrl: z.string().url('Enter a valid URL').or(z.literal('')),
  previewUrl:   z.string().url('Enter a valid URL').or(z.literal('')),
  price:        z.coerce.number().min(0, 'Price must be ≥ 0'),
  priceAED:     z.coerce.number().min(0).optional(),
  priceINR:     z.coerce.number().min(0).optional(),
  isFree:       z.boolean(),
  status:       z.enum(['draft', 'published', 'archived']),
  level:        z.enum(['beginner', 'intermediate', 'advanced', '']),
  language:     z.string().min(1, 'Language required'),
  tags:         z.string(),
  categoryId:   z.string(),
  program:      z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura', '']),
  organizationId: z.string().optional(),
})

type Values = z.infer<typeof schema>

/* ── Tab config ─────────────────────────────────────────────── */
const TABS_BASE = [
  { id: 'basics',  label: 'Basics',   icon: BookOpen },
  { id: 'media',   label: 'Media',    icon: Image },
  { id: 'pricing', label: 'Pricing',  icon: DollarSign },
  { id: 'meta',    label: 'Meta',     icon: Tag },
  { id: 'publish', label: 'Publish',  icon: Settings },
] as const

const TABS_EDIT = [
  ...TABS_BASE,
  { id: 'modules', label: 'Modules',  icon: Layers },
] as const

type TabId = typeof TABS_EDIT[number]['id']

/* ── Field wrapper ───────────────────────────────────────────── */
function Field({ label, error, children, hint }: { label: string; error?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
        {label}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: '#F87171' }}>
            <AlertCircle size={11} />{error}
          </motion.p>
        )}
      </AnimatePresence>
      {hint && !error && <p className="mt-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{hint}</p>}
    </div>
  )
}

/* ── Input styles ────────────────────────────────────────────── */
const inputBase = "w-full rounded-xl px-4 py-2.5 text-sm text-white outline-none transition-all placeholder:text-white/25"
const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }
const inputFocus = (el: HTMLElement) => {
  el.style.border = '1px solid rgba(0,87,184,0.55)'
  el.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.10)'
}
const inputBlur = (el: HTMLElement) => {
  el.style.border = '1px solid rgba(255,255,255,0.09)'
  el.style.boxShadow = 'none'
}

/* ── Custom dark dropdown (replaces native <select> to avoid OS-white dropdown) ── */
function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  const selected = options.find(o => o.value === value)
  const displayLabel = selected?.label ?? placeholder ?? 'Select…'

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`${inputBase} flex cursor-pointer items-center justify-between pr-10`}
        style={inputStyle}>
        <span style={{ color: value ? '#fff' : 'rgba(255,255,255,0.3)' }}>{displayLabel}</span>
        <ChevronDown size={13} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 transition-transform"
          style={{ color: 'rgba(255,255,255,0.3)', transform: open ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl py-1"
            style={{ background: '#13141C', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
            {placeholder && (
              <button type="button" onClick={() => { onChange(''); setOpen(false) }}
                className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.05]"
                style={{ color: 'rgba(255,255,255,0.3)' }}>
                {placeholder}
              </button>
            )}
            {options.map(o => (
              <button key={o.value} type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.05]"
                style={{ color: o.value === value ? '#0057b8' : 'rgba(255,255,255,0.8)' }}>
                {o.label}
                {o.value === value && <Check size={12} style={{ color: '#0057b8' }} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────── */
interface CourseFormProps { course?: Course }

export function CourseForm({ course }: CourseFormProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>('basics')
  const [savedSuccess, setSavedSuccess] = useState(false)

  const createMutation = useCreateCourse()
  const updateMutation = useUpdateCourse()
  const { data: categories } = useCategories()

  /* Academy - super admins only. Working from "All Orgs" they have no
     implicit academy, and a course belonging to none appears in no
     academy's catalogue. The switcher supplies the default when set. */
  const { data: me } = useCurrentUser()
  const isSuper = me?.role === 'super_admin'
  const activeOrgId = useOrgStore(st => st.activeOrgId)
  const { data: orgs } = useOrganizations(isSuper)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const toast = useToast()
  const isEditing = !!course

  const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title:        course?.title        ?? '',
      slug:         course?.slug         ?? '',
      description:  course?.description  ?? '',
      thumbnailUrl: course?.thumbnailUrl ?? '',
      previewUrl:   course?.previewUrl   ?? '',
      price:        course?.price        ?? 0,
      priceAED:     course?.priceAED     ?? undefined,
      priceINR:     course?.priceINR     ?? undefined,
      isFree:       course?.isFree       ?? false,
      status:       course?.status       ?? 'draft',
      level:        course?.level        ?? '',
      language:     course?.language     ?? 'English',
      tags:         course?.tags?.join(', ') ?? '',
      categoryId:   course?.categoryId   ?? '',
      program:      course?.program       ?? '',
      organizationId: (course as { organizationId?: string } | undefined)?.organizationId ?? '',
    },
  })

  /* Follow the topbar switcher when it points at a single academy. */
  useEffect(() => {
    if (isSuper && activeOrgId && !watch('organizationId')) {
      setValue('organizationId', activeOrgId)
    }
  }, [isSuper, activeOrgId, watch, setValue])

  const isFree = watch('isFree')
  const titleVal = watch('title')

  // Auto-generate slug from title
  useEffect(() => {
    if (!isEditing) {
      const slug = titleVal.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
      setValue('slug', slug)
    }
  }, [titleVal, isEditing, setValue])

  const onSubmit = async (data: Values) => {
    setSubmitError(null)
    try {
      if (isEditing && course) {
        await updateMutation.mutateAsync({ id: course.id, data })
        toast.success('Course updated')
        setSavedSuccess(true)
        setTimeout(() => { router.push('/courses') }, 800)
      } else {
        const created = await createMutation.mutateAsync(data as CourseFormValues)
        toast.success('Course created — now add your modules!')
        setSavedSuccess(true)
        setTimeout(() => {
          router.push(created?.id ? `/courses/${created.id}/edit` : '/courses')
        }, 800)
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message
        ?? err?.response?.data?.error?.details?.[0]?.message
      setSubmitError(msg ?? 'Unable to save course. Please try again.')
    }
  }

  const tabErrors: Partial<Record<TabId, boolean>> = {
    basics:  !!(errors.title || errors.slug || errors.description),
    media:   !!(errors.thumbnailUrl || errors.previewUrl),
    pricing: !!(errors.price),
    meta:    !!(errors.language),
    publish: !!(errors.status),
  }

  /* ── Shared tab nav (outside any form) ──────────── */
  const tabNav = (
    <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-2xl p-1"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      {(isEditing ? TABS_EDIT : TABS_BASE).map(tab => {
        const Icon   = tab.icon
        const active = activeTab === tab.id
        const hasErr = tabErrors[tab.id as TabId]
        return (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
            className="relative flex flex-shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all"
            style={active
              ? { background: 'rgba(0,87,184,0.16)', color: '#0057b8' }
              : { color: 'rgba(255,255,255,0.45)' }}>
            <Icon size={14} />
            {tab.label}
            {hasErr && (
              <span className="ml-0.5 h-1.5 w-1.5 rounded-full" style={{ background: '#EF4444' }} />
            )}
            {active && (
              <motion.div layoutId="tab-indicator" className="absolute inset-0 rounded-xl"
                style={{ background: 'rgba(0,87,184,0.14)' }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
            )}
          </button>
        )
      })}
    </div>
  )

  /* ── Modules panel — completely outside any form ─ */
  if (activeTab === 'modules' && course) {
    return (
      <>
        {tabNav}
        <ModulesSection courseId={course.id} />
      </>
    )
  }

  return (
    <>
      {tabNav}
      <form onSubmit={handleSubmit(onSubmit)}>
      {/* ── Tab panels ───────────────────────────────── */}
      <div className="rounded-2xl p-6" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <AnimatePresence mode="wait">
          {/* BASICS */}
          {activeTab === 'basics' && (
            <motion.div key="basics" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }} className="space-y-5">
              <Field label="Course title *" error={errors.title?.message}>
                <input {...register('title')} placeholder="e.g. Complete Web Development Bootcamp"
                  className={inputBase} style={inputStyle}
                  onFocus={e => inputFocus(e.currentTarget)} onBlur={e => inputBlur(e.currentTarget)} />
              </Field>

              <Field label="Slug *" error={errors.slug?.message} hint="Auto-generated from title. Only lowercase letters, numbers, hyphens.">
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-mono select-none"
                    style={{ color: 'rgba(255,255,255,0.25)' }}>deltagroups.ae/</span>
                  <input {...register('slug')} placeholder="course-slug"
                    className={`${inputBase} pl-24`} style={inputStyle}
                    onFocus={e => inputFocus(e.currentTarget)} onBlur={e => inputBlur(e.currentTarget)} />
                </div>
              </Field>

              <Field label="Description *" error={errors.description?.message} hint="Min 20 characters. Shown to students on the course page.">
                <textarea {...register('description')} rows={5} placeholder="Describe what students will learn…"
                  className={`${inputBase} resize-none`} style={inputStyle}
                  onFocus={e => inputFocus(e.currentTarget)} onBlur={e => inputBlur(e.currentTarget)} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Level">
                  <Controller name="level" control={control} render={({ field }) => (
                    <Select value={field.value} onChange={field.onChange} placeholder="Select level"
                      options={[
                        { value: 'beginner', label: 'Beginner' },
                        { value: 'intermediate', label: 'Intermediate' },
                        { value: 'advanced', label: 'Advanced' },
                      ]} />
                  )} />
                </Field>
                <Field label="Language *" error={errors.language?.message}>
                  <Controller name="language" control={control} render={({ field }) => (
                    <Select value={field.value} onChange={field.onChange}
                      options={courseLanguageOptions(field.value)} />
                  )} />
                </Field>
              </div>
            </motion.div>
          )}

          {/* MEDIA */}
          {activeTab === 'media' && (
            <motion.div key="media" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }} className="space-y-6">

              {/* Thumbnail — URL or file upload */}
              <Controller
                name="thumbnailUrl"
                control={control}
                render={({ field }) => (
                  <MediaUploadField
                    type="image"
                    label="Course thumbnail"
                    hint="Recommended: 1280×720px (16:9) · JPG, PNG, WebP · max 5 MB"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    error={errors.thumbnailUrl?.message}
                  />
                )}
              />

              {/* Preview video — URL or file upload */}
              <Controller
                name="previewUrl"
                control={control}
                render={({ field }) => (
                  <MediaUploadField
                    type="video"
                    label="Preview video"
                    hint="Optional free-preview clip shown to non-enrolled visitors"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    error={errors.previewUrl?.message}
                  />
                )}
              />
            </motion.div>
          )}

          {/* PRICING */}
          {activeTab === 'pricing' && (
            <motion.div key="pricing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }} className="space-y-5">
              {/* Free toggle */}
              <div className="flex items-center justify-between rounded-2xl p-4"
                style={{ background: isFree ? 'rgba(74,222,128,0.07)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isFree ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.08)'}`, transition: 'all 0.3s' }}>
                <div>
                  <p className="text-sm font-semibold text-white">Free course</p>
                  <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Make this course available at no cost</p>
                </div>
                <Controller name="isFree" control={control} render={({ field }) => (
                  <button type="button" onClick={() => field.onChange(!field.value)}
                    className="relative h-6 w-11 rounded-full transition-all"
                    style={{ background: field.value ? '#4ADE80' : 'rgba(255,255,255,0.12)' }}>
                    <motion.div animate={{ x: field.value ? 22 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white" />
                  </button>
                )} />
              </div>

              <AnimatePresence>
                {!isFree && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                    <Field label="Price (USD) *" error={errors.price?.message}>
                      <div className="relative">
                        <DollarSign size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                        <input {...register('price')} type="number" step="0.01" min="0" placeholder="49.99"
                          className={`${inputBase} pl-10`} style={inputStyle}
                          onFocus={e => inputFocus(e.currentTarget)} onBlur={e => inputBlur(e.currentTarget)} />
                      </div>
                    </Field>

                    {/* Quick price presets */}
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {[9.99, 19.99, 29.99, 49.99, 79.99, 99.99].map(p => (
                        <button key={p} type="button" onClick={() => setValue('price', p)}
                          className="rounded-lg px-3 py-1 text-xs font-semibold transition-colors hover:bg-white/10"
                          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          ${p}
                        </button>
                      ))}
                    </div>

                    {/* AED price — Abzer, Tabby, Tamara.
                        Blank falls back to the configured conversion rate; it does
                        NOT turn a gateway off. The INR hint used to claim it did
                        (B-01), which was untrue in two ways: the value was never
                        stored at all, and the gateway is chosen by the academy's
                        currency rather than by this field. */}
                    <div className="mt-5">
                      <Field label="Price (AED) — Abzer / Tabby / Tamara" hint="Leave blank to convert from the USD price at the configured rate" error={(errors as any).priceAED?.message}>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>د.إ</span>
                          <input {...register('priceAED')} type="number" step="1" min="0" placeholder="367"
                            className={`${inputBase} pl-12`} style={inputStyle}
                            onFocus={e => inputFocus(e.currentTarget)} onBlur={e => inputBlur(e.currentTarget)} />
                        </div>
                        <div className="mt-3 flex gap-2 flex-wrap">
                          {[199, 367, 499, 999, 1499, 1999].map(p => (
                            <button key={p} type="button" onClick={() => setValue('priceAED' as any, p)}
                              className="rounded-lg px-3 py-1 text-xs font-semibold transition-colors hover:bg-white/10"
                              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              د.إ{p}
                            </button>
                          ))}
                        </div>
                      </Field>
                    </div>

                    {/* INR price for Razorpay */}
                    <div className="mt-5">
                      <Field label="Price (INR) — Razorpay" hint="Leave blank to convert from the USD price at the configured rate" error={(errors as any).priceINR?.message}>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>₹</span>
                          <input {...register('priceINR')} type="number" step="1" min="0" placeholder="999"
                            className={`${inputBase} pl-10`} style={inputStyle}
                            onFocus={e => inputFocus(e.currentTarget)} onBlur={e => inputBlur(e.currentTarget)} />
                        </div>
                        <div className="mt-3 flex gap-2 flex-wrap">
                          {[499, 999, 1499, 1999, 2999, 4999].map(p => (
                            <button key={p} type="button" onClick={() => setValue('priceINR' as any, p)}
                              className="rounded-lg px-3 py-1 text-xs font-semibold transition-colors hover:bg-white/10"
                              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              ₹{p}
                            </button>
                          ))}
                        </div>
                      </Field>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* META */}
          {activeTab === 'meta' && (
            <motion.div key="meta" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }} className="space-y-5">
              <Field label="Tags" hint="Comma-separated: react, typescript, advanced">
                <div className="relative">
                  <Tag size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                  <input {...register('tags')} placeholder="react, hooks, typescript"
                    className={`${inputBase} pl-10`} style={inputStyle}
                    onFocus={e => inputFocus(e.currentTarget)} onBlur={e => inputBlur(e.currentTarget)} />
                </div>
                {/* Tag pills preview */}
                {watch('tags') && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {watch('tags').split(',').map(t => t.trim()).filter(Boolean).map(t => (
                      <span key={t} className="rounded-lg px-2.5 py-1 text-[11px] font-medium"
                        style={{ background: 'rgba(0,87,184,0.12)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.2)' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="Category">
                <Controller name="categoryId" control={control} render={({ field }) => (
                  <Select value={field.value} onChange={field.onChange} placeholder="Select category…"
                    options={(categories ?? []).map(c => ({ value: c.id, label: c.name }))} />
                )} />
              </Field>

              {/* Academy - super admins only; everyone else inherits their own. */}
              {isSuper && (
                <Field label="Academy *">
                  <Controller name="organizationId" control={control} render={({ field }) => (
                    <Select value={field.value ?? ''} onChange={field.onChange} placeholder="Select academy…"
                      options={(orgs ?? []).map(o => ({ value: o.id, label: o.name }))} />
                  )} />
                </Field>
              )}

              <Field label="Program *">
                <Controller name="program" control={control} render={({ field }) => (
                  <Select value={field.value} onChange={field.onChange} placeholder="Select program…"
                    options={[
                      { value: '4x-trading',        label: 'FOREX Trading' },
                      { value: 'jura',              label: 'JURA' },
                      { value: 'digital-marketing', label: 'Digital Marketing' },
                      { value: 'ai',                label: 'AI' },
                    ]} />
                )} />
              </Field>
            </motion.div>
          )}

          {/* PUBLISH */}
          {activeTab === 'publish' && (
            <motion.div key="publish" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }} className="space-y-4">
              <p className="text-sm font-semibold text-white mb-3">Publication status</p>
              {(['draft', 'published', 'archived'] as const).map(s => {
                const configs = {
                  draft:     { label: 'Draft',     desc: 'Only visible to you. Students cannot enroll.',        color: '#FACC15', bg: 'rgba(234,179,8,0.10)' },
                  published: { label: 'Published', desc: 'Live and visible to all students. Enrollment open.',   color: '#4ADE80', bg: 'rgba(34,197,94,0.10)' },
                  archived:  { label: 'Archived',  desc: 'Hidden from students. No new enrollments accepted.',  color: 'rgba(255,255,255,0.35)', bg: 'rgba(255,255,255,0.05)' },
                }
                const c = configs[s]
                const isSelected = watch('status') === s
                return (
                  <Controller key={s} name="status" control={control} render={({ field }) => (
                    <motion.button type="button" onClick={() => field.onChange(s)} whileTap={{ scale: 0.99 }}
                      className="flex w-full items-start gap-4 rounded-2xl p-4 transition-all text-left"
                      style={{
                        background: isSelected ? c.bg : 'rgba(255,255,255,0.02)',
                        border: `1.5px solid ${isSelected ? c.color + '50' : 'rgba(255,255,255,0.07)'}`,
                      }}>
                      <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2"
                        style={{ borderColor: isSelected ? c.color : 'rgba(255,255,255,0.2)', background: isSelected ? c.color : 'transparent' }}>
                        {isSelected && <Check size={9} color="#000" strokeWidth={3} />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: isSelected ? c.color : 'rgba(255,255,255,0.7)' }}>{c.label}</p>
                        <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{c.desc}</p>
                      </div>
                    </motion.button>
                  )} />
                )
              })}
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <AnimatePresence>
        {submitError && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.20)', color: '#FCA5A5' }}>
            <AlertCircle size={14} />{submitError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer actions ───────────────────────────── */}
      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={() => router.push('/courses')}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-white/[0.06]"
          style={{ color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <ArrowLeft size={14} />Discard
        </button>

        <div className="flex items-center gap-3">
          {/* Tab nav dot shortcuts */}
          <div className="hidden items-center gap-1 sm:flex">
            {(isEditing ? TABS_EDIT : TABS_BASE).map((tab) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className="flex h-1.5 rounded-full transition-all"
                style={{ width: activeTab === tab.id ? 16 : 6, background: activeTab === tab.id ? '#0057b8' : 'rgba(255,255,255,0.15)' }} />
            ))}
          </div>

          <motion.button type="submit" disabled={isSubmitting || savedSuccess}
            whileHover={{ y: -1, boxShadow: '0 10px 28px rgba(0,87,184,0.4)' }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-70"
            style={{ background: savedSuccess ? 'linear-gradient(135deg, #22C55E, #16A34A)' : 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 20px rgba(0,87,184,0.28)' }}>
            {isSubmitting
              ? <><Spinner size={14} />{isEditing ? 'Saving…' : 'Creating…'}</>
              : savedSuccess
              ? <><Check size={14} />Saved!</>
              : isEditing ? 'Save changes' : 'Create course'}
          </motion.button>
        </div>
      </div>
      </form>
    </>
  )
}
