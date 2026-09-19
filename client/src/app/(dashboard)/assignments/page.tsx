'use client'

import { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ClipboardList, Upload, X, FileText, Image as ImageIcon, CheckCircle2,
  Clock, RotateCcw, AlertTriangle, Paperclip, Calendar, BookOpen, Layers, User,
} from 'lucide-react'
import {
  useSubmittableSessions, useMyClassAssignments, useSubmitClassAssignment,
  useResubmitClassAssignment, uploadAssignmentFile,
  type AssignmentFile, type MyClassAssignment, type ClassAssignmentStatus,
} from '@/lib/api/classAssignments'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'
import { titleCase } from '@/lib/titleCase'

/* ── Constants that mirror the API's own limits ──────────
   Keeping these in step with the backend is what makes the form refuse a
   file BEFORE spending the upload, rather than after. The API is still the
   authority — this is convenience, not enforcement. */
const MAX_FILES  = 10
const MAX_BYTES  = 10 * 1024 * 1024
const ACCEPT     = 'image/jpeg,image/png,image/webp,application/pdf'
const ACCEPT_SET = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
function fmtDate(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateTime(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const STATUS: Record<ClassAssignmentStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  pending:  { label: 'Awaiting review', color: '#B45309', bg: 'rgba(245,158,11,0.10)', Icon: Clock },
  approved: { label: 'Approved',        color: 'var(--color-success)', bg: 'rgba(16,185,129,0.10)', Icon: CheckCircle2 },
  rejected: { label: 'Needs changes',   color: 'var(--color-danger)', bg: 'rgba(239,68,68,0.10)',  Icon: AlertTriangle },
}

/* ── Attachment picker ───────────────────────────────── */
function FilePicker({
  files, setFiles, busy, setBusy,
}: {
  files:   AssignmentFile[]
  setFiles: (f: AssignmentFile[]) => void
  busy:    boolean
  setBusy: (b: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const toast    = useToast()

  const add = async (picked: FileList | null) => {
    if (!picked?.length) return
    const list = Array.from(picked)
    if (files.length + list.length > MAX_FILES) {
      toast.error(`Up to ${MAX_FILES} files`, `You already have ${files.length}.`)
      return
    }
    setBusy(true)
    const accepted: AssignmentFile[] = []
    for (const f of list) {
      if (!ACCEPT_SET.has(f.type)) { toast.error(`${f.name} is not a photo or PDF`); continue }
      if (f.size > MAX_BYTES)      { toast.error(`${f.name} is over 10 MB`); continue }
      try {
        accepted.push(await uploadAssignmentFile(f))
      } catch (e: any) {
        toast.error(`Could not upload ${f.name}`, e?.response?.data?.error?.message)
      }
    }
    setFiles([...files, ...accepted])
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden"
        onChange={e => void add(e.target.files)} />

      {/* Drop zone rather than a button-shaped strip: it is the one place on
          this form that accepts a file, so it should read as an area you can
          drop onto. The dashed rule was a hardcoded grey that ignored the
          theme; it now uses the border token at rest and the brand blue on
          hover, with the tint coming up to meet it — enough feedback to say
          "this is a target" without animating on a surface people are
          reading. */}
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || files.length >= MAX_FILES}
        className="group flex w-full flex-col items-center justify-center gap-2 rounded-xl px-4 py-6 text-sm font-semibold transition-all duration-200 disabled:opacity-50 hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]"
        style={{ border: '1.5px dashed var(--color-border-strong)', color: 'var(--color-primary)', background: 'var(--color-bg-inset)' }}>
        <span className="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
          style={{ background: 'var(--color-primary-light)' }}>
          {busy ? <Spinner /> : <Upload size={17} strokeWidth={1.75} />}
        </span>
        {busy ? 'Uploading…' : files.length ? 'Add another file' : 'Add photos or PDFs'}
        {!busy && !files.length && (
          <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Click to browse from your device
          </span>
        )}
      </button>
      <p className="mt-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        JPG, PNG, WebP or PDF · up to 10 MB each · {MAX_FILES} files max
      </p>

      {files.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {files.map((f, i) => (
            <motion.li key={`${f.url}-${i}`} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2"
              style={{ background: 'var(--color-bg-page)', border: '1px solid var(--color-border)' }}>
              {f.mimeType === 'application/pdf'
                ? <FileText size={15} style={{ color: 'var(--color-danger)' }} className="flex-shrink-0" />
                : <ImageIcon size={15} style={{ color: 'var(--color-primary)' }} className="flex-shrink-0" />}
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>{f.name}</span>
              <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{fmtSize(f.sizeBytes)}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                /* The hit area was the 13px glyph, 8px from the file size, on
                   the only way to undo a wrong photo before submitting. */
                className="-mr-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover-danger)] hover:text-red-500 sm:-mr-0 sm:h-auto sm:w-auto" style={{ color: 'var(--color-text-muted)' }}>
                <X size={15} className="sm:hidden" />
                <X size={13} className="hidden sm:block" />
              </button>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── New submission ──────────────────────────────────── */
function SubmitCard() {
  const { data: sessions, isLoading } = useSubmittableSessions()
  const { data: mine }                = useMyClassAssignments()
  const submit = useSubmitClassAssignment()
  const toast  = useToast()

  const [classId, setClassId] = useState('')
  const [title,   setTitle]   = useState('')
  const [note,    setNote]    = useState('')
  const [files,   setFiles]   = useState<AssignmentFile[]>([])
  const [busy,    setBusy]    = useState(false)

  /* One submission per class. Hiding the ones already sent is friendlier
     than letting the student fill the whole form and then meeting a 409. */
  const taken = useMemo(
    () => new Set((mine ?? []).map(a => a.liveClassId?.id).filter(Boolean) as string[]),
    [mine],
  )
  const available = (sessions ?? []).filter(s => !taken.has(s.id))
  const picked    = available.find(s => s.id === classId)

  const reset = () => { setClassId(''); setTitle(''); setNote(''); setFiles([]) }

  const send = async () => {
    if (!classId)          return toast.error('Pick the class this work is for')
    if (title.trim().length < 3) return toast.error('Give your work a title', 'At least 3 characters.')
    if (files.length === 0) return toast.error('Attach at least one photo or file')
    try {
      await submit.mutateAsync({ liveClassId: classId, title: title.trim(), note: note.trim() || undefined, files })
      toast.success('Sent to your instructor', 'You will be notified when it is reviewed.')
      reset()
    } catch (e: any) {
      const code = e?.response?.data?.error?.code
      if (code === 'ALREADY_SUBMITTED') toast.error('Already sent', 'You have a submission for this class.')
      else if (code === 'NOT_BOOKED')   toast.error('Not your class', 'You can only submit for classes you booked.')
      else toast.error('Could not send', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  if (isLoading) {
    return <div className="flex justify-center rounded-2xl bg-[var(--color-bg-surface)] p-10" style={{ border: '1px solid var(--color-border)' }}><Spinner /></div>
  }

  if (available.length === 0) {
    return (
      <div className="rounded-2xl bg-[var(--color-bg-surface)] p-6 text-center" style={{ border: '1px solid var(--color-border)' }}>
        <ClipboardList size={22} style={{ color: 'var(--color-text-muted)' }} className="mx-auto mb-2" />
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {(sessions ?? []).length === 0 ? 'No classes yet' : 'All caught up'}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {(sessions ?? []).length === 0
            ? 'Book and attend a live class, then send your work to the instructor here.'
            : 'You have already sent work for every class you attended.'}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-[var(--color-bg-surface)] p-5" style={{ border: '1px solid var(--color-border)' }}>
      <h2 className="mb-4 text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Send new work</h2>

      {/* Class — the only thing to choose. Course, module and instructor
          follow from it, so there is no way to send work to the wrong person. */}
      <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Which class is this for?</label>
      <select value={classId} onChange={e => setClassId(e.target.value)}
        className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
        style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-inset)', color: 'var(--color-text-primary)' }}>
        <option value="">Select a class you attended…</option>
        {available.map(s => (
          <option key={s.id} value={s.id}>{titleCase(s.title)} — {fmtDate(s.scheduledStart)}</option>
        ))}
      </select>

      <AnimatePresence>
        {picked && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="mt-3 grid gap-2 rounded-xl px-3 py-2.5 sm:grid-cols-3"
              style={{ background: 'rgba(0,87,184,0.05)', border: '1px solid rgba(0,87,184,0.14)' }}>
              <span className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                <BookOpen size={11} style={{ color: 'var(--color-primary)' }} />{picked.courseId?.title ?? '—'}
              </span>
              <span className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                <Layers size={11} style={{ color: 'var(--color-primary)' }} />{picked.sectionId?.title ?? 'No module'}
              </span>
              <span className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                <User size={11} style={{ color: 'var(--color-primary)' }} />{picked.instructorId?.name ?? '—'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <label className="mb-1.5 mt-4 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
        placeholder="e.g. Position sizing worksheet"
        className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
        style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-inset)', color: 'var(--color-text-primary)' }} />

      <label className="mb-1.5 mt-4 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
        Note to your instructor <span style={{ color: 'var(--color-text-muted)' }}>(optional)</span>
      </label>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={5000}
        placeholder="Anything they should know while reviewing…"
        className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
        style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-inset)', color: 'var(--color-text-primary)' }} />

      <div className="mt-4">
        <FilePicker files={files} setFiles={setFiles} busy={busy} setBusy={setBusy} />
      </div>

      <button type="button" onClick={() => void send()} disabled={submit.isPending || busy}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-50"
        style={{ background: 'var(--color-primary)' }}>
        {submit.isPending ? <Spinner /> : <Paperclip size={14} />}
        {submit.isPending ? 'Sending…' : 'Send to instructor'}
      </button>
    </div>
  )
}

/* ── One submission in the list ──────────────────────── */
function AssignmentCard({ a }: { a: MyClassAssignment }) {
  const resubmit = useResubmitClassAssignment()
  const toast    = useToast()
  const [open,  setOpen]  = useState(false)
  const [note,  setNote]  = useState('')
  const [files, setFiles] = useState<AssignmentFile[]>([])
  const [busy,  setBusy]  = useState(false)

  const { label, color, bg, Icon } = STATUS[a.status]

  const send = async () => {
    if (files.length === 0) return toast.error('Attach at least one photo or file')
    try {
      await resubmit.mutateAsync({ id: a.id, note: note.trim() || undefined, files })
      toast.success('Revision sent', 'Your instructor has been notified.')
      setOpen(false); setFiles([]); setNote('')
    } catch (e: any) {
      toast.error('Could not send', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-[var(--color-bg-surface)] p-4" style={{ border: '1px solid var(--color-border)' }}>

      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: bg }}>
          <Icon size={15} style={{ color }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: bg, color }}>{label}</span>
            {a.attempt > 1 && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'var(--color-bg-page)', color: 'var(--color-text-muted)' }}>Attempt {a.attempt}</span>
            )}
          </div>
          <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>{titleCase(a.title)}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <span className="flex items-center gap-1"><Calendar size={10} />{a.liveClassId?.title ?? 'Class'}</span>
            {a.instructorId?.name && <><span>·</span><span>{a.instructorId.name}</span></>}
            <span>·</span><span>Sent {fmtDateTime(a.submittedAt)}</span>
          </div>
        </div>
      </div>

      {a.note && <p className="mt-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{a.note}</p>}

      {a.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.files.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--color-hover)]"
              style={{ background: 'var(--color-bg-page)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              {f.mimeType === 'application/pdf'
                ? <FileText size={11} style={{ color: 'var(--color-danger)' }} />
                : <ImageIcon size={11} style={{ color: 'var(--color-primary)' }} />}
              <span className="max-w-[160px] truncate">{f.name}</span>
            </a>
          ))}
        </div>
      )}

      {/* The reason is the whole point of a rejection — give it its own block,
          not a line of grey body text. */}
      {a.status === 'rejected' && a.lastReason && (
        <div className="mt-3 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-danger)' }}>
            What to change
          </p>
          <p className="text-xs" style={{ color: '#7F1D1D' }}>{a.lastReason}</p>
        </div>
      )}

      {a.status === 'rejected' && (
        <>
          {!open ? (
            <button type="button" onClick={() => setOpen(true)}
              className="mt-3 flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white"
              style={{ background: 'var(--color-primary)' }}>
              <RotateCcw size={12} />Send a revision
            </button>
          ) : (
            <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={5000}
                placeholder="What you changed (optional)"
                className="mb-3 w-full resize-none rounded-lg px-3 py-2 text-xs outline-none"
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }} />
              <FilePicker files={files} setFiles={setFiles} busy={busy} setBusy={setBusy} />
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => void send()} disabled={resubmit.isPending || busy}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: 'var(--color-primary)' }}>
                  {resubmit.isPending ? <Spinner /> : <RotateCcw size={12} />}Send revision
                </button>
                <button type="button" onClick={() => { setOpen(false); setFiles([]); setNote('') }}
                  className="rounded-xl px-4 py-2 text-xs font-semibold"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Earlier rounds, so a student can see what changed between attempts. */}
      {a.reviews.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            Review history ({a.reviews.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {a.reviews.map((r, i) => (
              <li key={i} className="rounded-lg px-2.5 py-1.5 text-[11px]"
                style={{ background: 'var(--color-bg-page)', color: 'var(--color-text-secondary)' }}>
                <span className="font-semibold">Attempt {r.attempt}: {r.status}</span>
                {r.reason && <> — {r.reason}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </motion.div>
  )
}

/* ── Page ────────────────────────────────────────────── */
export default function AssignmentsPage() {
  const { data: mine, isLoading } = useMyClassAssignments()
  const [filter, setFilter] = useState<'all' | ClassAssignmentStatus>('all')

  const list  = mine ?? []
  const shown = filter === 'all' ? list : list.filter(a => a.status === filter)
  const count = (s: ClassAssignmentStatus) => list.filter(a => a.status === s).length

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          <ClipboardList size={20} style={{ color: 'var(--color-primary)' }} />Assignments
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Send your work to the instructor who ran the class, and see what they said.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <SubmitCard />

        <div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {([
              ['all', `All (${list.length})`],
              ['pending', `Awaiting review (${count('pending')})`],
              ['rejected', `Needs changes (${count('rejected')})`],
              ['approved', `Approved (${count('approved')})`],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key as typeof filter)}
                className="inline-flex min-h-[44px] items-center rounded-full px-3.5 text-[12px] font-semibold transition-colors sm:min-h-0 sm:px-3 sm:py-1.5 sm:text-[11px]"
                style={filter === key
                  ? { background: 'var(--color-primary)', color: '#fff' }
                  : { background: 'var(--color-bg-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                {label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex justify-center rounded-2xl bg-[var(--color-bg-surface)] p-10" style={{ border: '1px solid var(--color-border)' }}><Spinner /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl bg-[var(--color-bg-surface)] p-8 text-center" style={{ border: '1px solid var(--color-border)' }}>
              <ClipboardList size={22} style={{ color: 'var(--color-text-muted)' }} className="mx-auto mb-2" />
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {list.length === 0 ? 'Nothing sent yet' : 'Nothing here'}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {list.length === 0 ? 'Your submissions will appear here.' : 'Try another filter.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <AnimatePresence mode="popLayout">
                {shown.map(a => <AssignmentCard key={a.id} a={a} />)}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
