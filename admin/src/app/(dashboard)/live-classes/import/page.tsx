'use client'

/* Import timetable — upload a weekly timetable (.xlsx), preview every class it
   would create, choose what to keep, then import. Nothing is written until
   "Import"; every import can be undone. Backend: classImport.service.ts */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import readXlsxFile from 'read-excel-file/browser'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, XCircle,
  Video, Monitor, Building2, RotateCcw, Undo2, Loader2, CalendarDays, Users,
} from 'lucide-react'
import { useCourses } from '@/lib/api/courses'
import { CLASS_LANGUAGES } from '@/lib/languages'
import {
  usePreviewImport, useStartImport, useImportJob, useImportJobs, useResumeImport, useUndoImport, importKeys,
  type ImportSettings, type PreviewResult, type PreviewRow, type RowOverride, type ImportPlatform,
} from '@/lib/api/classImport'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'

/* ── look ─────────────────────────────────────────────── */
const card   = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' } as const
const input  = 'w-full rounded-lg px-3 py-2 text-sm text-white outline-none'
const inputS = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' } as const
const label  = 'block text-xs font-semibold mb-1.5'
const labelS = { color: 'rgba(255,255,255,0.55)' } as const
const muted  = { color: 'rgba(255,255,255,0.45)' } as const

const STATUS = {
  ready:   { c: '#34D399', bg: 'rgba(52,211,153,0.12)',  Icon: CheckCircle2,  t: 'Ready' },
  warning: { c: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  Icon: AlertTriangle, t: 'Check' },
  error:   { c: '#F87171', bg: 'rgba(248,113,113,0.12)', Icon: XCircle,       t: 'Blocked' },
} as const
const OCC = {
  new:      { c: '#93C5FD', bg: 'rgba(59,130,246,0.14)' },
  exists:   { c: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.05)' },
  conflict: { c: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
  past:     { c: 'rgba(255,255,255,0.3)', bg: 'rgba(255,255,255,0.03)' },
} as const

/* "MALAYALAM BATCH" means Malayalam, in any case. A label that names exactly one
   language sets the class language: on 2 Oct a Malayalam batch went in as
   English, because only the file name was ever read, and only when the label
   was still empty. A label naming two ("ENG/HINDI") is left to the dropdown. */
function languageNamedIn(text: string): string | undefined {
  if (text.includes('/')) return undefined
  const hits = CLASS_LANGUAGES.filter(l => !l.value.includes('/')
    && new RegExp(`\\b${l.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
  return hits.length === 1 ? hits[0]!.value : undefined
}

/* ── reading the workbook (in the browser — the file is never uploaded) ── */
type SheetRow = Record<string, string>

function cellText(v: unknown, header: string): string {
  if (v == null) return ''
  const hm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (v instanceof Date) return hm(v.getUTCHours(), v.getUTCMinutes())
  if (typeof v === 'number') {
    /* A time cell stored as a fraction of a day (0.5 = 12:00). */
    if (/time|start|end/i.test(header) && v >= 0 && v < 1) {
      const mins = Math.round(v * 1440)
      return hm(Math.floor(mins / 60) % 24, mins % 60)
    }
    return String(v)
  }
  return String(v).trim()
}

async function readWorkbook(file: File): Promise<{ sheet: string; rows: SheetRow[] }> {
  const sheets = await readXlsxFile(file)
  const n = (s: unknown) => String(s ?? '').toLowerCase().trim()
  const chosen = sheets.find(s => n(s.sheet) === 'sessions' || n(s.sheet) === 'timetable')
    ?? sheets.find(s => (s.data[0] ?? []).some(c => n(c) === 'day'))
    ?? sheets[0]
  if (!chosen || chosen.data.length < 2) throw new Error('No rows found. Put one session per row under a header row.')
  const [head, ...body] = chosen.data
  const headers = (head ?? []).map(h => String(h ?? '').trim())
  const rows = body
    .filter(r => r.some(c => c != null && String(c).trim() !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, cellText(r[i], h).slice(0, 500)]).filter(([h]) => h)) as SheetRow)
  if (rows.length > 500) throw new Error(`That sheet has ${rows.length} rows — import at most 500 at a time.`)
  return { sheet: chosen.sheet, rows }
}

const nextTuesdayISO = () => {
  const d = new Date(); d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7))
  return d.toISOString().slice(0, 10)
}
const fmtKey = (k: string | null) => k
  ? new Date(`${k}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  : '—'

export default function ImportTimetablePage() {
  const toast = useToast()
  const { data: courses } = useCourses({ per_page: 100 })
  const preview = usePreviewImport()
  const start   = useStartImport()

  const [file, setFile]       = useState<{ name: string; sheet: string; rows: SheetRow[] } | null>(null)
  const [readErr, setReadErr] = useState<string | null>(null)
  const [settings, setSettings] = useState<ImportSettings>({
    courseId: '', startDate: nextTuesdayISO(), weeks: 4, capacity: 30, language: 'English',
    titleLabel: '', location: '', room: '', defaultPlatform: 'inapp',
  })
  const [overrides, setOverrides] = useState<Record<number, RowOverride>>({})
  /* Module picked in the preview, per session code ("MMC 1" → a module id, or
     'none'). Sent as each matching row's module column, which the importer reads
     the same way as one typed into the sheet. */
  const [moduleChoice, setModuleChoice] = useState<Record<string, string>>({})
  const [result, setResult]   = useState<PreviewResult | null>(null)
  const [jobId, setJobId]     = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const payload = useCallback((ov = overrides, mc = moduleChoice) => {
    const codeOf = new Map((result?.rows ?? []).map(r => [r.rowNumber, r.code]))
    return {
      settings: { ...settings, titleLabel: settings.titleLabel || undefined, location: settings.location || undefined, room: settings.room || undefined },
      /* rowNumber = index + 2 (the header is row 1), as the preview counts them */
      rows: (file?.rows ?? []).map((r, i) => {
        const code = codeOf.get(i + 2)
        return code && mc[code] ? { ...r, module: mc[code]! } : r
      }),
      overrides: Object.fromEntries(Object.entries(ov).map(([k, v]) => [String(k), v])),
      fileName: file?.name,
    }
  }, [settings, file, overrides, moduleChoice, result])

  const runPreview = useCallback(async (ov = overrides, mc = moduleChoice) => {
    if (!file || !settings.courseId) return
    try {
      setResult(await preview.mutateAsync(payload(ov, mc)))
    } catch (e: any) {
      toast.error('Could not preview', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }, [file, settings.courseId, overrides, moduleChoice, payload, preview, toast])

  /* Settings changed after a preview → refresh it (debounced). */
  const firstPreview = useRef(true)
  useEffect(() => {
    if (!result) { firstPreview.current = true; return }
    if (firstPreview.current) { firstPreview.current = false; return }
    const t = setTimeout(() => { void runPreview() }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  const setModuleFor = (code: string, value: string) => {
    const next = { ...moduleChoice, [code]: value }
    setModuleChoice(next)
    void runPreview(overrides, next)
  }

  const setOverride = (rowNumber: number, patch: RowOverride) => {
    const next = { ...overrides, [rowNumber]: { ...overrides[rowNumber], ...patch } }
    setOverrides(next)
    void runPreview(next)
  }

  async function onFile(f: File | undefined) {
    if (!f) return
    setReadErr(null); setResult(null); setOverrides({}); setModuleChoice({}); setJobId(null)
    try {
      const wb = await readWorkbook(f)
      setFile({ name: f.name, ...wb })
      if (!settings.titleLabel) {
        const guess = /english/i.test(f.name) ? 'English batch' : /malayalam/i.test(f.name) ? 'Malayalam batch' : ''
        if (guess) setSettings(s => ({ ...s, titleLabel: guess, language: languageNamedIn(guess) ?? s.language }))
      }
    } catch (e: any) {
      setFile(null); setReadErr(e?.message ?? 'Could not read that file.')
    }
  }

  async function onImport() {
    if (!result) return
    const n = result.summary.classes
    const where = (result.summary.courses ?? 1) > 1 ? `${result.summary.courses} courses` : `"${courseLabel(result)}"`
    if (!confirm(`Create ${n} classes in ${where}?\n\n${result.summary.meet} Google Meet · ${result.summary.inapp} in-app${result.summary.offline ? ` · ${result.summary.offline} in-person` : ''}\n${fmtKey(result.summary.firstDate)} → ${fmtKey(result.summary.lastDate)}\n\nYou can undo this import afterwards.`)) return
    try {
      const r = await start.mutateAsync(payload())
      setJobId(r.jobId)
      toast.success('Import started', `${r.total} classes are being created.`)
    } catch (e: any) {
      toast.error('Could not start the import', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  const canPreview = !!file && !!settings.courseId && !preview.isPending
  const s = result?.summary

  return (
    <div className="pb-20">
      <Link href="/live-classes" className="mb-4 inline-flex items-center gap-1.5 text-sm" style={muted}>
        <ArrowLeft className="h-4 w-4" /> Live Classes
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Import timetable</h1>
          <p className="mt-0.5 text-sm" style={muted}>Upload a weekly timetable, check every class it will create, then import. Nothing is saved until you press Import.</p>
        </div>
        <a href="/templates/live-class-import-template.xlsx" download
          className="inline-flex items-center gap-1.5 self-start rounded-xl px-3 py-2 text-xs font-semibold"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Download className="h-3.5 w-3.5" /> Download template
        </a>
      </div>

      {jobId ? (
        <JobPanel jobId={jobId} onNew={() => { setJobId(null); setResult(null); setFile(null); setOverrides({}) }} />
      ) : (
        <>
          {/* ── 1 + 2: file and settings ───────────────── */}
          <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <section className="rounded-2xl p-5" style={card}>
              <h2 className="mb-3 text-sm font-bold text-white">1 · Timetable file</h2>
              <button type="button" onClick={() => fileInput.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); void onFile(e.dataTransfer.files?.[0]) }}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl px-4 py-8 text-center transition-colors"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1.5px dashed rgba(255,255,255,0.15)' }}>
                {file ? <FileSpreadsheet className="h-8 w-8" style={{ color: '#34D399' }} /> : <Upload className="h-8 w-8" style={muted} />}
                <span className="text-sm font-semibold text-white">{file ? file.name : 'Choose or drop an .xlsx file'}</span>
                <span className="text-xs" style={muted}>
                  {file ? `${file.rows.length} sessions in sheet "${file.sheet}" · click to change` : 'One row per weekly session — see the template'}
                </span>
              </button>
              <input ref={fileInput} type="file" accept=".xlsx" className="hidden" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
              {readErr && <p className="mt-3 text-xs" style={{ color: '#F87171' }}>{readErr}</p>}
            </section>

            <section className="rounded-2xl p-5" style={card}>
              <h2 className="mb-3 text-sm font-bold text-white">2 · Where and when</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={label} style={labelS}>Course</label>
                  <select className={input} style={inputS} value={settings.courseId}
                    onChange={e => setSettings(s => ({ ...s, courseId: e.target.value }))}>
                    <option value="" style={{ background: '#0D0F1A' }}>Select a course…</option>
                    {(courses?.docs ?? []).map(c => <option key={c.id} value={c.id} style={{ background: '#0D0F1A' }}>{c.title}</option>)}
                  </select>
                  <p className="mt-1 text-[11px]" style={muted}>
                    Each row goes into the module its session code names (“MBT 4”, “IM 1”) or its module column gives. A module this course doesn&apos;t have is looked for in the academy&apos;s other courses of the same programme, and the row goes there.
                  </p>
                </div>
                <div>
                  <label className={label} style={labelS}>First week starts</label>
                  <input type="date" className={input} style={inputS} value={settings.startDate}
                    onChange={e => setSettings(s => ({ ...s, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className={label} style={labelS}>Number of weeks</label>
                  <input type="number" min={1} max={52} className={input} style={inputS} value={settings.weeks}
                    onChange={e => setSettings(s => ({ ...s, weeks: Math.max(1, Math.min(52, Number(e.target.value) || 1)) }))} />
                </div>
                <div>
                  <label className={label} style={labelS}>Seats per class</label>
                  <input type="number" min={1} max={500} className={input} style={inputS} value={settings.capacity}
                    onChange={e => setSettings(s => ({ ...s, capacity: Math.max(1, Number(e.target.value) || 1) }))} />
                </div>
                <div>
                  <label className={label} style={labelS}>Language</label>
                  <select className={input} style={inputS} value={settings.language}
                    onChange={e => setSettings(s => ({ ...s, language: e.target.value }))}>
                    {CLASS_LANGUAGES.map(l => <option key={l.value} value={l.value} style={{ background: '#0D0F1A' }}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} style={labelS}>Title label</label>
                  <input className={input} style={inputS} placeholder="e.g. English batch" value={settings.titleLabel}
                    onChange={e => { const v = e.target.value; setSettings(s => ({ ...s, titleLabel: v, language: languageNamedIn(v) ?? s.language })) }} />
                </div>
                <div>
                  <label className={label} style={labelS}>Platform when the file doesn&apos;t say</label>
                  <div className="flex gap-2">
                    {([['inapp', 'In-app', Monitor], ['meet', 'Google Meet', Video]] as const).map(([v, t, I]) => (
                      <button key={v} type="button" onClick={() => setSettings(s => ({ ...s, defaultPlatform: v }))}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold"
                        style={settings.defaultPlatform === v
                          ? { background: 'rgba(0,87,184,0.25)', color: '#fff', border: '1px solid rgba(77,155,255,0.5)' }
                          : { ...inputS, color: 'rgba(255,255,255,0.55)' }}>
                        <I className="h-3.5 w-3.5" />{t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={label} style={labelS}>Location (Offline + Online)</label>
                  <input className={input} style={inputS} placeholder="e.g. Dubai Campus" value={settings.location}
                    onChange={e => setSettings(s => ({ ...s, location: e.target.value }))} />
                </div>
                <div>
                  <label className={label} style={labelS}>Room (unless the file sets one)</label>
                  <input className={input} style={inputS} placeholder="e.g. Room 1" value={settings.room}
                    onChange={e => setSettings(s => ({ ...s, room: e.target.value }))} />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => { setOverrides({}); void runPreview({}) }} disabled={!canPreview}>
                  {preview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                  {result ? 'Refresh preview' : 'Preview classes'}
                </Button>
              </div>
            </section>
          </div>

          {/* ── 3: preview ───────────────────────────────── */}
          {result && s && (
            <section className="mt-5 rounded-2xl p-5" style={card}>
              <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                <h2 className="text-sm font-bold text-white">3 · Preview — {(s.courses ?? 1) > 1 ? `${s.courses} courses` : courseLabel(result)}</h2>
                <Stat n={s.classes} t="classes to create" strong />
                <Stat n={s.meet} t="Google Meet" icon={<Video className="h-3.5 w-3.5" />} />
                <Stat n={s.inapp} t="in-app" icon={<Monitor className="h-3.5 w-3.5" />} />
                {s.offline > 0 && <Stat n={s.offline} t="in person" icon={<Building2 className="h-3.5 w-3.5" />} />}
                <Stat n={s.mentors} t="mentors" icon={<Users className="h-3.5 w-3.5" />} />
                <span className="text-xs" style={muted}>{fmtKey(s.firstDate)} → {fmtKey(s.lastDate)} · times in {result.academy.tag}</span>
                <span className="ml-auto flex gap-2 text-xs">
                  <Badge kind="ready" n={s.ready} /><Badge kind="warning" n={s.warnings} /><Badge kind="error" n={s.errors} />
                </span>
              </div>
              {result.settingsErrors.length > 0 && (
                <p className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(248,113,113,0.12)', color: '#FCA5A5' }}>{result.settingsErrors.join(' ')}</p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs" style={muted}>
                      <th className="py-2 pr-3"><span className="sr-only">Include</span></th>
                      <th className="py-2 pr-3 font-semibold">Day &amp; time</th>
                      <th className="py-2 pr-3 font-semibold">Session</th>
                      <th className="py-2 pr-3 font-semibold">Module</th>
                      <th className="py-2 pr-3 font-semibold">Mentor</th>
                      <th className="py-2 pr-3 font-semibold">Platform</th>
                      <th className="py-2 pr-3 font-semibold">Dates</th>
                      <th className="py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map(r => (
                      <Row key={r.rowNumber} r={r} tag={result.academy.tag} instructors={result.instructors}
                        home={result.course}
                        courses={result.courses ?? [{ ...result.course, modules: result.modules ?? [] }]}
                        picked={!!(r.code && moduleChoice[r.code])}
                        onModule={v => { if (r.code) setModuleFor(r.code, v) }}
                        onInclude={v => setOverride(r.rowNumber, { include: v })}
                        onPlatform={v => setOverride(r.rowNumber, { platform: v })}
                        onMentor={v => setOverride(r.rowNumber, { instructorId: v })} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                <p className="text-xs" style={muted}>
                  Mentors get one summary email instead of one per class. Students are not notified class by class.
                  {s.errors > 0 && ' Blocked rows are skipped — fix them in the file and preview again.'}
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => { setResult(null); setOverrides({}); setModuleChoice({}) }}>Cancel</Button>
                  <Button onClick={onImport} disabled={s.classes === 0 || result.settingsErrors.length > 0 || start.isPending || preview.isPending}>
                    {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Import {s.classes} classes
                  </Button>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <RecentImports onOpen={setJobId} />
    </div>
  )
}

/* The one course every included row goes to (or the chosen one, if none is included). */
const courseLabel = (p: PreviewResult) => p.rows.find(r => r.include)?.course?.title ?? p.course.title

/* ── preview row ──────────────────────────────────────── */
function Row({ r, tag, instructors, home, courses, picked, onModule, onInclude, onPlatform, onMentor }: {
  r: PreviewRow; tag: string; instructors: PreviewResult['instructors']
  /* The chosen course, and every course a row may go to — the chosen one first. */
  home: PreviewResult['course']; courses: NonNullable<PreviewResult['courses']>
  /* A module was picked here for this row's session code. */
  picked: boolean; onModule: (v: string) => void
  onInclude: (v: boolean) => void; onPlatform: (v: ImportPlatform) => void; onMentor: (v: string) => void
}) {
  const st = STATUS[r.status]
  const blocked = r.status === 'error'
  const withModules = courses.filter(c => c.modules.length > 0)
  /* A chosen course with modules always offers the pick — it is how a blocked
     row is fixed and a found one corrected. One without modules imports as it
     always did, so only a row that went elsewhere, or is blocked, offers it. */
  const canPick = !!r.code && withModules.length > 0 && ((courses[0]?.modules.length ?? 0) > 0 || !!r.module || blocked)
  const routed = !!r.course && r.course.id !== home.id
  const how = r.moduleFrom === 'name' ? `matched “${r.code}”`
    : r.moduleFrom === 'sheet' || r.moduleFrom === 'none' ? (picked ? 'picked' : 'from the file') : ''
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.06)', opacity: r.include || blocked ? 1 : 0.5 }}>
      <td className="py-3 pr-3 align-top">
        <input type="checkbox" className="h-4 w-4 accent-[#0057b8]" checked={r.include} disabled={blocked || r.newCount === 0}
          onChange={e => onInclude(e.target.checked)} aria-label={`Include ${r.title}`} />
      </td>
      <td className="py-3 pr-3 align-top whitespace-nowrap">
        <div className="font-semibold text-white">{r.day}</div>
        <div className="text-xs" style={muted}>{r.startLabel} – {r.endLabel} {tag}</div>
      </td>
      <td className="py-3 pr-3 align-top">
        <div className="text-white">{r.title}</div>
        <div className="text-xs" style={muted}>
          {r.sessionId !== '—' ? `${r.sessionId} · ` : ''}
          {r.mode === 'hybrid' ? `Offline + Online${r.room ? ` · ${r.room}` : ''}` : r.mode === 'offline' ? `In person${r.room ? ` · ${r.room}` : ''}` : 'Online only'}
        </div>
      </td>
      <td className="py-3 pr-3 align-top">
        {/* Which module the classes go into — and so which course. Picking
            applies to every row of this session code, and a row with no match
            stays blocked until a module (or "No module") is picked. */}
        {canPick ? (
          <select className="max-w-[240px] rounded-lg px-2 py-1 text-xs text-white outline-none" style={inputS}
            aria-label={`Module for ${r.code}`}
            value={r.module?.id ?? (r.moduleFrom === 'none' ? 'none' : '')}
            onChange={e => onModule(e.target.value)}>
            <option value="" style={{ background: '#0D0F1A' }}>Pick the module for “{r.code}”…</option>
            {withModules.length > 1
              ? withModules.map(c => (
                  <optgroup key={c.id} label={c.title} style={{ background: '#0D0F1A' }}>
                    {c.modules.map(m => <option key={m.id} value={m.id} style={{ background: '#0D0F1A' }}>{m.title}</option>)}
                  </optgroup>
                ))
              : withModules[0]!.modules.map(m => <option key={m.id} value={m.id} style={{ background: '#0D0F1A' }}>{m.title}</option>)}
            <option value="none" style={{ background: '#0D0F1A' }}>No module (General sessions)</option>
          </select>
        ) : (
          <div className="text-white">{r.module?.title ?? '—'}</div>
        )}
        {(routed || how) && (
          <div className="mt-0.5 max-w-[240px] truncate text-xs" style={muted} title={r.course?.title}>
            {routed ? r.course!.title : ''}{routed && how ? ' · ' : ''}{how}
          </div>
        )}
      </td>
      <td className="py-3 pr-3 align-top">
        {/* A guess — by first name, or a staff account that is not an
            instructor — keeps the picker, so it can be corrected here. */}
        {r.instructor && r.matchedBy !== 'first-name' && r.matchedBy !== 'staff' ? (
          <div className="text-white">{r.instructor.name}</div>
        ) : (
          <select className="rounded-lg px-2 py-1 text-xs text-white outline-none" style={inputS}
            value={r.instructor?.id ?? ''} onChange={e => onMentor(e.target.value)}>
            <option value="" style={{ background: '#0D0F1A' }}>Pick for “{r.mentorName || '?'}”…</option>
            {instructors.map(i => <option key={i.id} value={i.id} style={{ background: '#0D0F1A' }}>{i.name}{i.email ? ` · ${i.email}` : ''}</option>)}
          </select>
        )}
        <div className="text-xs" style={muted}>{r.mentorName && r.instructor?.name !== r.mentorName ? `“${r.mentorName}” in file` : ''}</div>
      </td>
      <td className="py-3 pr-3 align-top">
        {r.platform === null ? (
          <span className="text-xs" style={muted}>No link (in person)</span>
        ) : (
          <select className="rounded-lg px-2 py-1 text-xs text-white outline-none" style={inputS}
            value={r.platform} onChange={e => onPlatform(e.target.value as ImportPlatform)} disabled={blocked}>
            <option value="inapp" style={{ background: '#0D0F1A' }}>In-app</option>
            <option value="meet" style={{ background: '#0D0F1A' }}>Google Meet</option>
          </select>
        )}
      </td>
      <td className="py-3 pr-3 align-top">
        <div className="flex max-w-[260px] flex-wrap gap-1">
          {r.occurrences.map(o => (
            <span key={o.dateKey} title={o.note ?? (o.state === 'past' ? 'In the past — skipped' : 'Will be created')}
              className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
              style={{ background: OCC[o.state].bg, color: OCC[o.state].c, textDecoration: o.state === 'past' || o.state === 'exists' ? 'line-through' : undefined }}>
              {o.label}
            </span>
          ))}
        </div>
      </td>
      <td className="py-3 align-top">
        <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: st.bg, color: st.c }}>
          <st.Icon className="h-3.5 w-3.5" />{st.t}
        </span>
        {r.messages.map((m, i) => <div key={i} className="mt-1 max-w-[280px] text-xs" style={{ color: blocked ? '#FCA5A5' : 'rgba(255,255,255,0.5)' }}>{m}</div>)}
      </td>
    </tr>
  )
}

function Stat({ n, t, icon, strong }: { n: number; t: string; icon?: React.ReactNode; strong?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={muted}>
      {icon}<b className={strong ? 'text-base text-white' : 'text-white'}>{n}</b>{t}
    </span>
  )
}
function Badge({ kind, n }: { kind: keyof typeof STATUS; n: number }) {
  const st = STATUS[kind]
  return <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold" style={{ background: st.bg, color: st.c }}><st.Icon className="h-3 w-3" />{n}</span>
}

/* ── progress of a running / finished import ─────────── */
function JobPanel({ jobId, onNew }: { jobId: string; onNew: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: job } = useImportJob(jobId)
  const resume = useResumeImport()
  const undo = useUndoImport()
  const busy = !!job && (job.running || job.status === 'running')
  /* The "Recent imports" list is not polled; refresh it when this run settles. */
  useEffect(() => {
    if (job && !busy) void qc.invalidateQueries({ queryKey: importKeys.list })
  }, [busy, job?.status, qc]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!job) return <div className="flex justify-center py-16"><Spinner /></div>
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0

  async function onUndo() {
    if (!confirm(`Undo this import?\n\nEvery class it created is deleted — except any a student has already booked, which are kept.\nGoogle Calendar invitations already sent for Meet classes stay on the mentors' calendars.`)) return
    try {
      const r = await undo.mutateAsync(jobId)
      toast.success('Import undone', `${r.deleted} classes removed${r.kept ? `, ${r.kept} kept because they have bookings or have started` : ''}.`)
    } catch (e: any) { toast.error('Could not undo', e?.response?.data?.error?.message ?? 'Please try again.') }
  }

  return (
    <section className="rounded-2xl p-6" style={card}>
      <div className="flex items-center gap-3">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" style={{ color: '#93C5FD' }} />
          : job.status === 'undone' ? <Undo2 className="h-5 w-5" style={muted} />
          : job.failed ? <AlertTriangle className="h-5 w-5" style={{ color: '#FBBF24' }} />
          : <CheckCircle2 className="h-5 w-5" style={{ color: '#34D399' }} />}
        <h2 className="text-base font-bold text-white">
          {busy ? 'Creating classes…' : job.status === 'undone' ? 'Import undone'
            : job.status === 'interrupted' ? 'Import interrupted' : job.failed ? 'Import finished with problems' : 'Import complete'}
        </h2>
        <span className="ml-auto text-xs" style={muted}>{job.fileName}</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#0057b8,#2F6BFF)' }} />
      </div>
      <p className="mt-2 text-sm text-white">
        {job.done} of {job.total} · <span style={{ color: '#34D399' }}>{job.created} created</span>
        {job.skipped > 0 && <span style={muted}> · {job.skipped} already existed</span>}
        {job.failed > 0 && <span style={{ color: '#F87171' }}> · {job.failed} failed</span>}
      </p>
      {job.failures.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg p-3 text-xs" style={{ background: 'rgba(248,113,113,0.08)' }}>
          {job.failures.map((f, i) => <li key={i} style={{ color: '#FCA5A5' }}>{fmtKey(f.dateKey)} · {f.title} — {f.error}</li>)}
        </ul>
      )}
      {!busy && (
        <div className="mt-5 flex flex-wrap gap-2">
          {(job.failed > 0 || job.status === 'interrupted') && (
            <Button onClick={() => resume.mutate(jobId)} disabled={resume.isPending}><RotateCcw className="h-4 w-4" /> Retry the rest</Button>
          )}
          <Link href="/live-classes/timetable"><Button variant="outline-primary"><CalendarDays className="h-4 w-4" /> Open timetable</Button></Link>
          {job.status !== 'undone' && job.created > 0 && (
            <Button variant="ghost-danger" onClick={onUndo} disabled={undo.isPending}><Undo2 className="h-4 w-4" /> Undo this import</Button>
          )}
          <Button variant="ghost" onClick={onNew}>Import another file</Button>
        </div>
      )}
    </section>
  )
}

function RecentImports({ onOpen }: { onOpen: (id: string) => void }) {
  const { data } = useImportJobs()
  if (!data?.length) return null
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-bold text-white">Recent imports</h2>
      <div className="overflow-x-auto rounded-2xl" style={card}>
        <table className="w-full text-sm">
          <tbody>
            {data.map(j => (
              <tr key={j.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td className="px-4 py-2.5 text-white">{j.fileName || 'Timetable'}</td>
                <td className="px-4 py-2.5" style={muted}>{j.course}{(j.courses ?? 1) > 1 ? ` + ${j.courses! - 1} more` : ''}</td>
                <td className="px-4 py-2.5" style={muted}>{new Date(j.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                <td className="px-4 py-2.5 text-white">{j.created}/{j.total}{j.failed ? <span style={{ color: '#F87171' }}> · {j.failed} failed</span> : null}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: j.status === 'completed' ? '#34D399' : j.status === 'undone' ? 'rgba(255,255,255,0.4)' : '#FBBF24' }}>{j.status}</td>
                <td className="px-4 py-2.5 text-right"><button className="text-xs font-semibold" style={{ color: '#4d9bff' }} onClick={() => onOpen(j.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
