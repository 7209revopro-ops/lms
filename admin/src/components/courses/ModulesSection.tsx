'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Edit2, Trash2, ChevronDown, ChevronUp,
  Video, FileText, HelpCircle, ClipboardList,
  Clock, Lock, Eye, X, Check,
  BookOpen, Layers, GripVertical, MoreVertical,
  AlignLeft, Zap,
} from 'lucide-react'
import {
  useCourseOutline,
  useCreateSection, useUpdateSection, useDeleteSection, useReorderSections,
  useCreateLesson,  useUpdateLesson,  useDeleteLesson,  useReorderLessons,
  type AdminSection, type AdminLesson,
} from '@/lib/api/outline'
import { useToast } from '@/store/ui.store'
import { QuizEditor } from './QuizEditor'
import { AssignmentEditor } from './AssignmentEditor'
import { MediaUploadField } from '@/components/ui/MediaUploadField'
import { secondsToMinutes } from '@/lib/videoDuration'
import { TranscriptEditor } from './TranscriptEditor'
import Spinner from '@/components/ui/Spinner'

/* ── Lesson type config ───────────────────────────────────────── */
const TYPE_META: Record<AdminLesson['type'], {
  label: string; color: string; bg: string; border: string; Icon: React.ElementType
}> = {
  video:      { label: 'Video',      color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.2)',   Icon: Video        },
  article:    { label: 'Article',    color: '#A78BFA', bg: 'rgba(167,139,250,0.1)',  border: 'rgba(167,139,250,0.2)',  Icon: FileText     },
  quiz:       { label: 'Quiz',       color: '#FBBF24', bg: 'rgba(251,191,36,0.1)',   border: 'rgba(251,191,36,0.2)',   Icon: HelpCircle   },
  assignment: { label: 'Assignment', color: '#F472B6', bg: 'rgba(244,114,182,0.1)',  border: 'rgba(244,114,182,0.2)',  Icon: ClipboardList },
}

function fmt(mins: number) {
  if (!mins) return '0m'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
}

/* ── Shared field / input helpers ─────────────────────────────── */
const fieldStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }
const fieldClass = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none transition-all placeholder:text-white/25'

function onFocusField(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.border = '1px solid rgba(0,87,184,0.5)'
  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.09)'
}
function onBlurField(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.09)'
  e.currentTarget.style.boxShadow = 'none'
}

function FormField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{hint}</p>}
    </div>
  )
}

/* ── Lesson type selector ─────────────────────────────────────── */
function TypeSelector({ value, onChange }: { value: AdminLesson['type']; onChange: (v: AdminLesson['type']) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {(['video', 'article', 'quiz', 'assignment'] as const).map(t => {
        const m = TYPE_META[t]
        const Icon = m.Icon
        const active = value === t
        return (
          <button key={t} type="button" onClick={() => onChange(t)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
            style={{
              background:  active ? m.bg  : 'rgba(255,255,255,0.04)',
              color:       active ? m.color : 'rgba(255,255,255,0.4)',
              border:      active ? `1px solid ${m.border}` : '1px solid rgba(255,255,255,0.07)',
              boxShadow:   active ? `0 0 0 2px ${m.color}20` : 'none',
            }}>
            <Icon size={11} />{m.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── Add Module Modal ─────────────────────────────────────────── */
function ModuleModal({
  open, onClose, initial, onSave, saving,
}: {
  open: boolean
  onClose: () => void
  initial?: { title: string; description: string }
  onSave: (title: string, description: string) => Promise<void>
  saving: boolean
}) {
  const [title, setTitle]       = useState(initial?.title       ?? '')
  const [description, setDesc]  = useState(initial?.description ?? '')

  const isEdit = !!initial

  // Sync when initial changes (e.g. opening edit for different module)
  const reset = () => { setTitle(initial?.title ?? ''); setDesc(initial?.description ?? '') }

  const handleClose = () => { onClose(); reset() }

  const handleSave = async () => {
    if (!title.trim()) return
    await onSave(title.trim(), description.trim())
    handleClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="module-modal-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={handleClose}>
          <motion.div key="module-modal-panel"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="w-full max-w-md overflow-hidden rounded-2xl"
            style={{ background: '#1A1D2E', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl"
                  style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
                  <Layers size={14} style={{ color: '#0057b8' }} />
                </div>
                <h3 className="text-sm font-bold text-white">
                  {isEdit ? 'Edit Module' : 'Add New Module'}
                </h3>
              </div>
              <button onClick={handleClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/08"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 p-5">
              <FormField label="Module title *">
                <input
                  autoFocus
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                  placeholder="e.g. Introduction & Setup"
                  className={fieldClass}
                  style={fieldStyle}
                  onFocus={onFocusField} onBlur={onBlurField}
                />
              </FormField>

              <FormField label="Description" hint="Optional — shown on the module card">
                <textarea
                  value={description}
                  onChange={e => setDesc(e.target.value)}
                  rows={3}
                  placeholder="What will students learn in this module?"
                  className={`${fieldClass} resize-none`}
                  style={fieldStyle}
                  onFocus={onFocusField} onBlur={onBlurField}
                />
              </FormField>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4"
              style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <button onClick={handleClose}
                className="rounded-xl px-4 py-2 text-xs font-semibold transition-colors hover:bg-white/06"
                style={{ color: 'rgba(255,255,255,0.5)' }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!title.trim() || saving}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}>
                {saving ? <Spinner size={12} /> : <Check size={12} />}
                {isEdit ? 'Save changes' : 'Add module'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ── Add Lesson Form (inline) ─────────────────────────────────── */
function AddLessonForm({ courseId, sectionId, onClose }: { courseId: string; sectionId: string; onClose: () => void }) {
  const createLesson = useCreateLesson(courseId)
  const toast        = useToast()
  const [title,      setTitle]      = useState('')
  const [type,       setType]       = useState<AdminLesson['type']>('video')
  const [contentUrl, setContentUrl] = useState('')
  const [duration,   setDuration]   = useState<number>(0)
  const [isFree,     setIsFree]     = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    try {
      await createLesson.mutateAsync({
        sectionId, title: title.trim(), type,
        contentUrl: contentUrl.trim() || undefined,
        durationMins: duration || 0,
        isFree,
      })
      toast.success('Lesson added')
      onClose()
    } catch (err: any) {
      toast.error('Could not add lesson', err?.response?.data?.error?.message)
    }
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
      onSubmit={onSubmit}
      className="mt-2 overflow-hidden rounded-2xl"
      style={{ background: 'rgba(0,87,184,0.04)', border: '1px solid rgba(0,87,184,0.2)' }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="text-xs font-bold" style={{ color: '#0057b8' }}>New lesson</span>
        <button type="button" onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-white/08"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          <X size={13} />
        </button>
      </div>
      <div className="space-y-4 p-4">
        <FormField label="Lesson title">
          <input autoFocus required value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Introduction to the Course"
            className={fieldClass} style={fieldStyle} onFocus={onFocusField} onBlur={onBlurField} />
        </FormField>
        <FormField label="Lesson type">
          <TypeSelector value={type} onChange={setType} />
        </FormField>
        {/* No duration field — it is read from the video's own metadata. */}
        {(type === 'video' || type === 'article') && (
          <FormField
            label={type === 'video' ? 'Video content' : 'Article / resource'}
            hint={type === 'video' && duration > 0 ? `Detected length: ${duration} min` : undefined}>
            {/* 'document', not 'image': an article's resource is as often a PDF
                handout as a picture, and the image endpoint refuses one. */}
            <MediaUploadField
              mode="compact"
              type={type === 'video' ? 'video' : 'document'}
              value={contentUrl} onChange={setContentUrl}
              onDurationDetected={secs => setDuration(secondsToMinutes(secs))}
              placeholder={type === 'video' ? 'Video URL or upload file' : 'PDF or image URL, or upload'} />
          </FormField>
        )}
        <div className="flex items-center justify-between rounded-xl px-4 py-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            <p className="text-xs font-semibold text-white">Free preview</p>
            <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Allow non-enrolled users to preview</p>
          </div>
          <button type="button" onClick={() => setIsFree(v => !v)}
            className="relative h-5 w-9 rounded-full transition-colors shrink-0"
            style={{ background: isFree ? '#0057b8' : 'rgba(255,255,255,0.12)' }}>
            <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{ left: isFree ? '18px' : '2px' }} />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="rounded-xl px-4 py-2 text-xs font-semibold transition-colors hover:bg-white/06"
            style={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
          <button type="submit" disabled={!title.trim() || createLesson.isPending}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)', boxShadow: '0 4px 12px rgba(0,87,184,0.25)' }}>
            {createLesson.isPending ? <Spinner size={11} /> : <Check size={11} />}
            Add lesson
          </button>
        </div>
      </div>
    </motion.form>
  )
}

/* ── Edit Lesson Form (inline) ────────────────────────────────── */
function LessonEditForm({
  lesson, onSave, onCancel, pending,
}: {
  lesson:   AdminLesson
  onSave:   (dto: Partial<Omit<AdminLesson, 'id' | 'sectionId' | 'courseId' | 'createdAt' | 'updatedAt' | 'order'>>) => Promise<void>
  onCancel: () => void
  pending:  boolean
}) {
  const [title,      setTitle]      = useState(lesson.title)
  const [type,       setType]       = useState(lesson.type)
  const [contentUrl, setContentUrl] = useState(lesson.contentUrl ?? '')
  const [duration,   setDuration]   = useState(lesson.durationMins)
  const [isFree,     setIsFree]     = useState(lesson.isFree)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave({ title: title.trim(), type, contentUrl: contentUrl.trim(), durationMins: duration, isFree })
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      onSubmit={submit}
      className="overflow-hidden rounded-2xl"
      style={{ background: 'rgba(96,165,250,0.04)', border: '1px solid rgba(96,165,250,0.2)' }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="text-xs font-bold" style={{ color: '#60A5FA' }}>Edit lesson</span>
        <button type="button" onClick={onCancel}
          className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-white/08"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          <X size={13} />
        </button>
      </div>
      <div className="space-y-4 p-4">
        <FormField label="Lesson title">
          <input required value={title} onChange={e => setTitle(e.target.value)}
            className={fieldClass} style={fieldStyle} onFocus={onFocusField} onBlur={onBlurField} />
        </FormField>
        <FormField label="Lesson type">
          <TypeSelector value={type} onChange={setType} />
        </FormField>
        {/* No duration field — read from the video's own metadata. */}
        {(type === 'video' || type === 'article') && (
          <FormField
            label={type === 'video' ? 'Video content' : 'Article / resource'}
            hint={type === 'video' && duration > 0 ? `Detected length: ${duration} min` : undefined}>
            {/* 'document', not 'image': an article's resource is as often a PDF
                handout as a picture, and the image endpoint refuses one. */}
            <MediaUploadField mode="compact" type={type === 'video' ? 'video' : 'document'}
              value={contentUrl} onChange={setContentUrl}
              onDurationDetected={secs => setDuration(secondsToMinutes(secs))}
              placeholder={type === 'video' ? 'Video URL or upload file' : 'PDF or image URL, or upload'} />
          </FormField>
        )}
        {(type === 'video' || type === 'article') && (
          <FormField label="Transcript">
            <TranscriptEditor lessonId={lesson.id} initialText={lesson.transcript} />
          </FormField>
        )}
        <div className="flex items-center justify-between rounded-xl px-4 py-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            <p className="text-xs font-semibold text-white">Free preview</p>
            <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Allow non-enrolled users to preview</p>
          </div>
          <button type="button" onClick={() => setIsFree(v => !v)}
            className="relative h-5 w-9 rounded-full transition-colors shrink-0"
            style={{ background: isFree ? '#0057b8' : 'rgba(255,255,255,0.12)' }}>
            <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{ left: isFree ? '18px' : '2px' }} />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel}
            className="rounded-xl px-4 py-2 text-xs font-semibold transition-colors hover:bg-white/06"
            style={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
          <button type="submit" disabled={pending}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#3B82F6,#60A5FA)', boxShadow: '0 4px 12px rgba(59,130,246,0.25)' }}>
            {pending ? <Spinner size={11} /> : <Check size={11} />}
            Save changes
          </button>
        </div>
      </div>
    </motion.form>
  )
}

/* ── Lesson Row ───────────────────────────────────────────────── */
function LessonRow({
  courseId, lesson, index, total, onMoveUp, onMoveDown,
}: {
  courseId: string; lesson: AdminLesson; index: number; total: number
  onMoveUp: () => void; onMoveDown: () => void
}) {
  const updateLesson = useUpdateLesson(courseId)
  const deleteLesson = useDeleteLesson(courseId)
  const toast        = useToast()
  const [editing,        setEditing]        = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const meta = TYPE_META[lesson.type]
  const Icon = meta.Icon

  const onDelete = async () => {
    try {
      await deleteLesson.mutateAsync(lesson.id)
      toast.success('Lesson deleted')
    } catch (err: any) {
      toast.error('Could not delete', err?.response?.data?.error?.message)
      setConfirmDelete(false)
    }
  }

  if (editingContent && lesson.type === 'quiz') return <QuizEditor lessonId={lesson.id} onClose={() => setEditingContent(false)} />
  if (editingContent && lesson.type === 'assignment') return <AssignmentEditor lessonId={lesson.id} onClose={() => setEditingContent(false)} />
  if (editing) {
    return (
      <LessonEditForm
        lesson={lesson} pending={updateLesson.isPending}
        onCancel={() => setEditing(false)}
        onSave={async (dto) => {
          try {
            await updateLesson.mutateAsync({ id: lesson.id, ...dto })
            setEditing(false)
            toast.success('Lesson updated')
          } catch (err: any) {
            toast.error('Could not save', err?.response?.data?.error?.message)
          }
        }}
      />
    )
  }

  return (
    <motion.div layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
      className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
      style={{ background: 'rgba(255,255,255,0.025)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)' }}>

      {/* Reorder */}
      <div className="flex shrink-0 flex-col items-center gap-px opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onMoveUp} disabled={index === 0}
          className="flex h-3.5 w-3.5 items-center justify-center rounded disabled:opacity-20"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          <ChevronUp size={10} />
        </button>
        <GripVertical size={10} style={{ color: 'rgba(255,255,255,0.2)' }} />
        <button onClick={onMoveDown} disabled={index >= total - 1}
          className="flex h-3.5 w-3.5 items-center justify-center rounded disabled:opacity-20"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          <ChevronDown size={10} />
        </button>
      </div>

      {/* Type icon */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
        style={{ background: meta.bg, border: `1px solid ${meta.border}` }}>
        <Icon size={13} style={{ color: meta.color }} />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{lesson.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold rounded-md px-1.5 py-0.5"
            style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          {lesson.durationMins > 0 && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              <Clock size={9} />{fmt(lesson.durationMins)}
            </span>
          )}
          {lesson.isFree ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#4ADE80' }}>
              <Eye size={9} />Free preview
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.28)' }}>
              <Lock size={9} />Members only
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {(lesson.type === 'quiz' || lesson.type === 'assignment') && (
          <button onClick={() => setEditingContent(true)}
            className="rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-colors hover:opacity-80"
            style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
            Edit {lesson.type}
          </button>
        )}
        <button onClick={() => setEditing(true)}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/08"
          style={{ color: 'rgba(255,255,255,0.4)' }} title="Edit lesson">
          <Edit2 size={12} />
        </button>
        <AnimatePresence mode="wait">
          {!confirmDelete ? (
            <motion.button key="d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setConfirmDelete(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-red-500/10"
              style={{ color: 'rgba(248,113,113,0.6)' }} title="Delete">
              <Trash2 size={12} />
            </motion.button>
          ) : (
            <motion.div key="dc" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-1">
              <button onClick={onDelete} disabled={deleteLesson.isPending}
                className="rounded-lg px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
                style={{ background: '#EF4444' }}>
                {deleteLesson.isPending ? '…' : 'Delete'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="flex h-5 w-5 items-center justify-center rounded"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={10} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/* ── Module Card ──────────────────────────────────────────────── */
function ModuleCard({
  courseId, section, lessons, index, total,
  onMoveUp, onMoveDown, onEdit,
}: {
  courseId:    string
  section:     AdminSection
  lessons:     AdminLesson[]
  index:       number
  total:       number
  onMoveUp:    () => void
  onMoveDown:  () => void
  onEdit:      () => void
}) {
  const deleteSection  = useDeleteSection(courseId)
  const reorderLessons = useReorderLessons(courseId)
  const toast          = useToast()
  const [expanded,      setExpanded]      = useState(false)
  const [addingLesson,  setAddingLesson]  = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const totalDuration = lessons.reduce((acc, l) => acc + (l.durationMins ?? 0), 0)

  const onDelete = async () => {
    try {
      await deleteSection.mutateAsync(section.id)
      toast.success('Module deleted')
    } catch (err: any) {
      toast.error('Could not delete', err?.response?.data?.error?.message)
      setConfirmDelete(false)
    }
  }

  const moveLesson = async (i: number, dir: -1 | 1) => {
    const t = i + dir
    if (t < 0 || t >= lessons.length) return
    const next = [...lessons]
    const [moved] = next.splice(i, 1)
    if (moved) next.splice(t, 0, moved)
    try {
      await reorderLessons.mutateAsync({ sectionId: section.id, ids: next.map(l => l.id) })
    } catch (err: any) {
      toast.error('Could not reorder', err?.response?.data?.error?.message)
    }
  }

  const numBadge = String(index + 1).padStart(2, '0')

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="overflow-hidden rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

      {/* ── Card top ── */}
      <div className="flex items-start gap-4 p-5">

        {/* Reorder column */}
        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
          <button onClick={onMoveUp} disabled={index === 0}
            className="flex h-6 w-6 items-center justify-center rounded-lg transition-all hover:bg-white/08 disabled:opacity-20"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <ChevronUp size={13} />
          </button>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold"
            style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.25)' }}>
            {numBadge}
          </span>
          <button onClick={onMoveDown} disabled={index >= total - 1}
            className="flex h-6 w-6 items-center justify-center rounded-lg transition-all hover:bg-white/08 disabled:opacity-20"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <ChevronDown size={13} />
          </button>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-white leading-tight">{section.title}</p>
          {section.description ? (
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {section.description}
            </p>
          ) : (
            <p className="mt-1 text-xs italic" style={{ color: 'rgba(255,255,255,0.2)' }}>No description</p>
          )}

          {/* Stats row */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
              <Zap size={10} />
              {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'}
            </span>
            {totalDuration > 0 && (
              <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
                <Clock size={10} />{fmt(totalDuration)}
              </span>
            )}

            {/* Manage Lessons button */}
            <button
              onClick={() => { setExpanded(v => !v); setAddingLesson(false) }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
              style={{
                background: expanded ? 'rgba(0,87,184,0.12)' : 'rgba(255,255,255,0.05)',
                color: expanded ? '#0057b8' : 'rgba(255,255,255,0.5)',
                border: expanded ? '1px solid rgba(0,87,184,0.25)' : '1px solid transparent',
              }}>
              <BookOpen size={10} />
              {expanded ? 'Hide lessons' : 'Manage lessons'}
              <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown size={10} />
              </motion.span>
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onEdit}
            className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/08"
            style={{ color: 'rgba(255,255,255,0.4)' }} title="Edit module">
            <Edit2 size={13} />
          </button>

          <AnimatePresence mode="wait">
            {!confirmDelete ? (
              <motion.button key="del" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setConfirmDelete(true)}
                className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-red-500/10"
                style={{ color: 'rgba(248,113,113,0.6)' }} title="Delete module">
                <Trash2 size={13} />
              </motion.button>
            ) : (
              <motion.div key="confirm" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <span className="text-[10px] font-semibold" style={{ color: '#FCA5A5' }}>Delete?</span>
                <button onClick={onDelete} disabled={deleteSection.isPending}
                  className="rounded-lg px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
                  style={{ background: '#EF4444' }}>
                  {deleteSection.isPending ? '…' : 'Yes'}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="flex h-5 w-5 items-center justify-center rounded"
                  style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <X size={10} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Lessons panel (accordion) ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden">
            <div className="p-4 pt-0 space-y-1.5"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>

              {/* Lessons list */}
              {lessons.length === 0 && !addingLesson && (
                <div className="flex flex-col items-center justify-center py-6 rounded-xl mt-3"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)' }}>
                  <p className="mb-1 text-xs font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    No lessons in this module yet
                  </p>
                  <button onClick={() => setAddingLesson(true)}
                    className="mt-2 flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70"
                    style={{ color: '#0057b8' }}>
                    <Plus size={11} />Add first lesson
                  </button>
                </div>
              )}

              {lessons.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {lessons.map((l, i) => (
                    <LessonRow key={l.id} courseId={courseId} lesson={l}
                      index={i} total={lessons.length}
                      onMoveUp={() => moveLesson(i, -1)}
                      onMoveDown={() => moveLesson(i, +1)} />
                  ))}
                </div>
              )}

              {/* Add lesson form or button */}
              <AnimatePresence>
                {addingLesson ? (
                  <AddLessonForm
                    key="add-form"
                    courseId={courseId}
                    sectionId={section.id}
                    onClose={() => setAddingLesson(false)}
                  />
                ) : (
                  <motion.button key="add-btn"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    whileHover={{ x: 2 }}
                    onClick={() => setAddingLesson(true)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors w-full mt-2"
                    style={{ color: '#0057b8', background: 'rgba(0,87,184,0.04)', border: '1px dashed rgba(0,87,184,0.2)' }}>
                    <Plus size={12} />Add lesson
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ── Main: ModulesSection ─────────────────────────────────────── */
export function ModulesSection({ courseId }: { courseId: string }) {
  const { data: outline, isLoading } = useCourseOutline(courseId)
  const createSection   = useCreateSection(courseId)
  const updateSection   = useUpdateSection(courseId)
  const reorderSections = useReorderSections(courseId)
  const toast           = useToast()

  const [showModal,   setShowModal]   = useState(false)
  const [editTarget,  setEditTarget]  = useState<AdminSection | null>(null)
  const [saving,      setSaving]      = useState(false)

  const grouped = useMemo(() => {
    if (!outline) return []
    return outline.sections
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(s => ({
        section: s,
        lessons: outline.lessons.filter(l => l.sectionId === s.id).sort((a, b) => a.order - b.order),
      }))
  }, [outline])

  const totalLessons  = outline?.lessons.length ?? 0
  const totalDuration = (outline?.lessons ?? []).reduce((acc, l) => acc + (l.durationMins ?? 0), 0)

  const handleAdd = async (title: string, description: string) => {
    setSaving(true)
    try {
      await createSection.mutateAsync({ title, description })
      toast.success('Module added')
    } catch (err: any) {
      toast.error('Could not add module', err?.response?.data?.error?.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async (title: string, description: string) => {
    if (!editTarget) return
    setSaving(true)
    try {
      await updateSection.mutateAsync({ id: editTarget.id, title, description })
      toast.success('Module updated')
      setEditTarget(null)
    } catch (err: any) {
      toast.error('Could not update module', err?.response?.data?.error?.message)
    } finally {
      setSaving(false)
    }
  }

  const moveSection = async (index: number, dir: -1 | 1) => {
    if (!outline) return
    const ordered = [...outline.sections].sort((a, b) => a.order - b.order)
    const target  = index + dir
    if (target < 0 || target >= ordered.length) return
    const reordered = [...ordered]
    const [moved] = reordered.splice(index, 1)
    if (moved) reordered.splice(target, 0, moved)
    try {
      await reorderSections.mutateAsync(reordered.map(s => s.id))
    } catch (err: any) {
      toast.error('Could not reorder', err?.response?.data?.error?.message)
    }
  }

  return (
    <>
      {/* Add/Edit Module Modal */}
      <ModuleModal
        open={showModal || !!editTarget}
        onClose={() => { setShowModal(false); setEditTarget(null) }}
        initial={editTarget ? { title: editTarget.title, description: editTarget.description ?? '' } : undefined}
        onSave={editTarget ? handleEdit : handleAdd}
        saving={saving}
      />

      <div className="mt-8 overflow-hidden rounded-3xl"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.2)' }}>
              <Layers size={16} style={{ color: '#0057b8' }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                Modules
              </h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Build your course structure
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Stats */}
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
                <Layers size={10} />{grouped.length} {grouped.length === 1 ? 'module' : 'modules'}
              </span>
              <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
                <Zap size={10} />{totalLessons} lessons
              </span>
              {totalDuration > 0 && (
                <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
                  <Clock size={10} />{fmt(totalDuration)}
                </span>
              )}
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)', boxShadow: '0 4px 12px rgba(0,87,184,0.3)' }}>
              <Plus size={13} />Add Module
            </motion.button>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="p-5">
          {isLoading ? (
            /* Skeleton */
            <div className="space-y-4">
              {[1, 2].map(i => (
                <div key={i} className="animate-pulse rounded-2xl p-5"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <div className="h-6 w-6 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
                      <div className="h-8 w-8 rounded-xl" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <div className="h-6 w-6 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }} />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-48 rounded-lg" style={{ background: 'rgba(255,255,255,0.07)' }} />
                      <div className="h-3 w-72 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }} />
                      <div className="mt-3 flex gap-2">
                        <div className="h-6 w-20 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }} />
                        <div className="h-6 w-28 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : grouped.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ background: 'rgba(0,87,184,0.1)', border: '1px solid rgba(0,87,184,0.15)' }}>
                <Layers size={26} style={{ color: 'rgba(0,87,184,0.7)' }} />
              </div>
              <p className="mb-1 text-sm font-semibold text-white">No modules yet</p>
              <p className="mb-5 text-xs text-center" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Add your first module to start building<br />your course curriculum
              </p>
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)', boxShadow: '0 4px 14px rgba(0,87,184,0.3)' }}>
                <Plus size={14} />Add first module
              </motion.button>
            </div>
          ) : (
            /* Module cards */
            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {grouped.map((g, i) => (
                  <ModuleCard
                    key={g.section.id}
                    courseId={courseId}
                    section={g.section}
                    lessons={g.lessons}
                    index={i}
                    total={grouped.length}
                    onMoveUp={() => moveSection(i, -1)}
                    onMoveDown={() => moveSection(i, +1)}
                    onEdit={() => setEditTarget(g.section)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
