'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  GraduationCap, Plus, Pencil, Trash2,
  ChevronLeft, ChevronRight, X, Check, BookOpen,
  ChevronUp, ChevronDown, Search, Lock, AlertCircle,
} from 'lucide-react'
import {
  useAdminLearningPaths, useCreateLearningPath, useUpdateLearningPath, useDeleteLearningPath,
  type AdminLearningPath, type AdminLearningPathCourse,
} from '@/lib/api/stats'
import { useCourses } from '@/lib/api/courses'
import Spinner from '@/components/ui/Spinner'
import { useOrgCurrency, formatCoursePrice } from '@/lib/currency'

/* ─── Local types ────────────────────────────────────── */
interface CourseItem {
  courseId:       string
  title:          string
  thumbnailUrl?:  string
  isPrerequisite: boolean
}

interface FormState {
  title:        string
  description:  string
  thumbnailUrl: string
  status:       'draft' | 'published'
  courses:      CourseItem[]
}

/* ─── Helpers ─────────────────────────────────────────── */
function normaliseCourses(raw: AdminLearningPathCourse[]): CourseItem[] {
  return [...raw]
    .sort((a, b) => a.order - b.order)
    .map(c => {
      if (typeof c.courseId === 'object') {
        return { courseId: c.courseId.id, title: c.courseId.title, thumbnailUrl: c.courseId.thumbnailUrl, isPrerequisite: c.isPrerequisite }
      }
      return { courseId: c.courseId, title: 'Unknown course', thumbnailUrl: undefined, isPrerequisite: c.isPrerequisite }
    })
}

/* ─── Course picker ───────────────────────────────────── */
function CoursePicker({
  selectedIds,
  onAdd,
}: {
  selectedIds: string[]
  onAdd:       (item: CourseItem) => void
}) {
  const cur                 = useOrgCurrency()
  const [query,  setQuery]  = useState('')
  const [open,   setOpen]   = useState(false)
  const ref                 = useRef<HTMLDivElement>(null)

  const { data, isFetching } = useCourses({
    search:   query || undefined,
    status:   'published',
    per_page: 15,
  })

  /* Close on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const available = (data?.docs ?? []).filter(c => !selectedIds.includes(c.id))

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 rounded-xl px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <Search size={12} style={{ color: 'rgba(255,255,255,0.35)' }} />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search published courses to add…"
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
        />
        {isFetching && <Spinner size={11} variant="muted" />}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-xl shadow-2xl"
            style={{ background: '#1E2236', border: '1px solid rgba(255,255,255,0.12)' }}>
            {available.length === 0 ? (
              <p className="px-3 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {isFetching ? 'Searching…' : 'No matching published courses'}
              </p>
            ) : available.map(c => (
              <button
                key={c.id}
                onMouseDown={e => {
                  e.preventDefault()
                  onAdd({ courseId: c.id, title: c.title, thumbnailUrl: c.thumbnailUrl ?? undefined, isPrerequisite: false })
                  setQuery('')
                  setOpen(false)
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]">
                <div className="h-7 w-10 flex-shrink-0 overflow-hidden rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white">{c.title}</p>
                  <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {formatCoursePrice(c, cur)} · {c.level}
                  </p>
                </div>
                <Plus size={12} style={{ color: '#0057b8' }} />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Sortable course row ─────────────────────────────── */
function CourseRow({
  item,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onTogglePrereq,
  onRemove,
}: {
  item:           CourseItem
  index:          number
  total:          number
  onMoveUp:       () => void
  onMoveDown:     () => void
  onTogglePrereq: () => void
  onRemove:       () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      className="flex items-center gap-2 rounded-xl px-2 py-2"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>

      {/* Step number */}
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: 'rgba(0,87,184,0.35)' }}>
        {index + 1}
      </span>

      {/* Thumbnail */}
      <div className="h-7 w-10 flex-shrink-0 overflow-hidden rounded-lg"
        style={{ background: 'rgba(255,255,255,0.06)' }}>
        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
      </div>

      {/* Title */}
      <p className="flex-1 truncate text-xs font-medium text-white">{item.title}</p>

      {/* Prerequisite toggle */}
      <button
        onClick={onTogglePrereq}
        title={item.isPrerequisite ? 'Mark as optional' : 'Mark as prerequisite'}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors"
        style={{
          background: item.isPrerequisite ? 'rgba(0,87,184,0.2)' : 'rgba(255,255,255,0.06)',
          color:      item.isPrerequisite ? '#0057b8' : 'rgba(255,255,255,0.3)',
          border:     item.isPrerequisite ? '1px solid rgba(0,87,184,0.3)' : '1px solid transparent',
        }}>
        <Lock size={9} />Prereq
      </button>

      {/* Up / down */}
      <div className="flex flex-col gap-0.5">
        <button disabled={index === 0} onClick={onMoveUp}
          className="rounded p-0.5 disabled:opacity-20 hover:bg-white/10 transition-colors">
          <ChevronUp size={12} style={{ color: 'rgba(255,255,255,0.5)' }} />
        </button>
        <button disabled={index === total - 1} onClick={onMoveDown}
          className="rounded p-0.5 disabled:opacity-20 hover:bg-white/10 transition-colors">
          <ChevronDown size={12} style={{ color: 'rgba(255,255,255,0.5)' }} />
        </button>
      </div>

      {/* Remove */}
      <button onClick={onRemove}
        className="rounded-lg p-1 transition-colors hover:bg-white/[0.08]">
        <X size={12} style={{ color: '#F87171' }} />
      </button>
    </motion.div>
  )
}

/* ─── Form modal ──────────────────────────────────────── */
const EMPTY: FormState = { title: '', description: '', thumbnailUrl: '', status: 'draft', courses: [] }

function PathFormModal({ initial, onClose }: { initial?: AdminLearningPath; onClose: () => void }) {
  const create = useCreateLearningPath()
  const update = useUpdateLearningPath()

  const [form, setForm] = useState<FormState>(() => {
    if (!initial) return EMPTY
    return {
      title:        initial.title,
      description:  initial.description ?? '',
      thumbnailUrl: initial.thumbnailUrl ?? '',
      status:       initial.status,
      courses:      normaliseCourses(initial.courses),
    }
  })

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  /* ── Course list helpers ─────────────────────────── */
  const addCourse = (item: CourseItem) => {
    if (form.courses.some(c => c.courseId === item.courseId)) return
    setForm(f => ({ ...f, courses: [...f.courses, item] }))
  }

  const removeCourse = (index: number) =>
    setForm(f => ({ ...f, courses: f.courses.filter((_, i) => i !== index) }))

  const moveCourse = (index: number, dir: -1 | 1) => {
    setForm(f => {
      const arr = [...f.courses]
      const swap = index + dir
      if (swap < 0 || swap >= arr.length) return f
      ;[arr[index], arr[swap]] = [arr[swap]!, arr[index]!]
      return { ...f, courses: arr }
    })
  }

  const togglePrereq = (index: number) =>
    setForm(f => ({
      ...f,
      courses: f.courses.map((c, i) => i === index ? { ...c, isPrerequisite: !c.isPrerequisite } : c),
    }))

  /* ── Save ────────────────────────────────────────── */
  const handleSave = async () => {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true); setError(null)
    try {
      const payload = {
        title:        form.title.trim(),
        description:  form.description.trim() || undefined,
        thumbnailUrl: form.thumbnailUrl.trim() || undefined,
        status:       form.status,
        courses:      form.courses.map((c, i) => ({
          courseId:       c.courseId,
          order:          i + 1,
          isPrerequisite: c.isPrerequisite,
        })),
      }
      if (initial) {
        await update.mutateAsync({ id: initial.id, ...payload })
      } else {
        await create.mutateAsync(payload)
      }
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const inputCls   = 'w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none'
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }

  const field = (label: string, node: React.ReactNode) => (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
      {node}
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="flex w-full max-w-2xl flex-col rounded-2xl"
        style={{ background: '#1A1D2E', border: '1px solid rgba(255,255,255,0.1)', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <h2 className="text-base font-bold text-white">
            {initial ? 'Edit learning path' : 'New learning path'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10">
            <X size={16} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Metadata ─────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              {field('Title *', (
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Full-Stack Developer Path" className={inputCls} style={inputStyle} />
              ))}
            </div>

            {field('Description', (
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2} placeholder="Optional overview…"
                className={`${inputCls} resize-none col-span-2`} style={inputStyle} />
            ))}

            {field('Thumbnail URL', (
              <input value={form.thumbnailUrl} onChange={e => setForm(f => ({ ...f, thumbnailUrl: e.target.value }))}
                placeholder="https://…" className={inputCls} style={inputStyle} />
            ))}

            {field('Status', (
              <select value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as 'draft' | 'published' }))}
                className={inputCls} style={inputStyle}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            ))}
          </div>

          {/* ── Course sequence ───────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
                Course Sequence
              </span>
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {form.courses.length} {form.courses.length === 1 ? 'course' : 'courses'}
              </span>
            </div>

            {/* Picker */}
            <CoursePicker
              selectedIds={form.courses.map(c => c.courseId)}
              onAdd={addCourse}
            />

            {/* Prereq hint */}
            {form.courses.length > 0 && (
              <p className="flex items-center gap-1.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                <Lock size={9} />
                Mark a course as a Prerequisite to lock the next step until it's completed.
                Use ↑ ↓ to reorder.
              </p>
            )}

            {/* List */}
            <AnimatePresence mode="popLayout">
              {form.courses.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-2 rounded-xl py-8"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)' }}>
                  <BookOpen size={20} style={{ color: 'rgba(255,255,255,0.15)' }} />
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    Search above to add courses to this path
                  </p>
                </motion.div>
              ) : (
                <div className="space-y-1.5">
                  {form.courses.map((item, i) => (
                    <CourseRow
                      key={item.courseId}
                      item={item}
                      index={i}
                      total={form.courses.length}
                      onMoveUp={() => moveCourse(i, -1)}
                      onMoveDown={() => moveCourse(i, 1)}
                      onTogglePrereq={() => togglePrereq(i)}
                      onRemove={() => removeCourse(i)}
                    />
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
              <AlertCircle size={12} />{error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4"
          style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {form.courses.length} course{form.courses.length !== 1 ? 's' : ''} in sequence
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/[0.08]"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-bold text-white disabled:opacity-60 transition-all"
              style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
              {saving ? <Spinner size={13} /> : <Check size={13} />}
              {saving ? 'Saving…' : 'Save path'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────── */
export default function AdminLearningPathsPage() {
  const [page,     setPage]     = useState(1)
  const [modal,    setModal]    = useState<'create' | AdminLearningPath | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const { data, isLoading } = useAdminLearningPaths(page)
  const del = useDeleteLearningPath()

  const handleDelete = async (path: AdminLearningPath) => {
    if (!confirm(`Delete "${path.title}"? This cannot be undone.`)) return
    setDeleting(path.id)
    try {
      await del.mutateAsync(path.id)
    } catch (err: any) {
      alert(err?.response?.data?.error?.message ?? 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Learning Paths
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Curated course sequences with optional prerequisites.
          </p>
        </div>
        <button onClick={() => setModal('create')}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
          <Plus size={14} /> New path
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['Title', 'Courses', 'Learners', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold"
                  style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="py-16 text-center">
                <Spinner size={18} variant="muted" />
              </td></tr>
            ) : !data?.paths.length ? (
              <tr><td colSpan={5} className="py-16 text-center text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
                No learning paths yet. Create one to get started.
              </td></tr>
            ) : data.paths.map((p, i) => {
              const instructor = typeof p.instructorId === 'object' ? p.instructorId : null
              return (
                <motion.tr key={p.id}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>

                  {/* Title + instructor */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {p.thumbnailUrl
                        ? <img src={p.thumbnailUrl} alt="" className="h-8 w-12 flex-shrink-0 rounded-lg object-cover" />
                        : (
                          <div className="flex h-8 w-12 flex-shrink-0 items-center justify-center rounded-lg"
                            style={{ background: 'rgba(0,87,184,0.12)' }}>
                            <GraduationCap size={14} style={{ color: '#0057b8' }} />
                          </div>
                        )}
                      <div>
                        <p className="font-semibold text-white line-clamp-1">{p.title}</p>
                        {instructor && (
                          <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                            {instructor.name}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Course count + inline preview */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        <BookOpen size={11} />{p.courses.length}
                      </span>
                      {p.courses.some(c => c.isPrerequisite) && (
                        <span title="Has prerequisites"
                          className="flex items-center rounded px-1 text-[9px] font-bold"
                          style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8' }}>
                          <Lock size={8} className="mr-0.5" />prereq
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Learners */}
                  <td className="px-4 py-3 tabular-nums" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    {p.enrolledCount.toLocaleString()}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className="rounded-lg px-2 py-0.5 text-[11px] font-semibold capitalize"
                      style={{
                        background: p.status === 'published' ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)',
                        color:      p.status === 'published' ? '#4ADE80' : 'rgba(255,255,255,0.4)',
                      }}>
                      {p.status}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setModal(p)}
                        className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08]">
                        <Pencil size={12} style={{ color: 'rgba(255,255,255,0.5)' }} />
                      </button>
                      <button onClick={() => handleDelete(p)} disabled={deleting === p.id}
                        className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] disabled:opacity-40">
                        {deleting === p.id
                          ? <Spinner size={12} />
                          : <Trash2 size={12} style={{ color: '#F87171' }} />}
                      </button>
                    </div>
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>

        {data?.meta && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Page {data.meta.page} of {data.meta.total_pages}
            </p>
            <div className="flex gap-1">
              <button disabled={!data.meta.has_prev} onClick={() => setPage(p => p - 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 hover:bg-white/[0.05]">
                <ChevronLeft size={14} style={{ color: 'white' }} />
              </button>
              <button disabled={!data.meta.has_next} onClick={() => setPage(p => p + 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 hover:bg-white/[0.05]">
                <ChevronRight size={14} style={{ color: 'white' }} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {modal !== null && (
          <PathFormModal
            initial={modal === 'create' ? undefined : modal}
            onClose={() => setModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
