'use client'

/**
 * MediaUploadField
 * ─────────────────
 * A drop-in replacement for a plain URL <input> that also lets the user
 * pick / drag-drop a file and upload it to the backend.
 *
 * Two display modes:
 *   • "full"    – tabbed card (URL | Upload) — used in CourseForm media tab
 *   • "compact" – inline text input with a paperclip upload button appended
 *                 — used in the compact lesson outline editor rows
 *
 * Props:
 *   value      – controlled URL value
 *   onChange   – called with the new URL (either typed or returned from upload)
 *   type       – "image" | "video"  (controls accept filter and upload endpoint)
 *   label      – field label (full mode only)
 *   hint       – help text shown below the label (full mode only)
 *   error      – validation error message
 *   mode       – "full" (default) | "compact"
 *   placeholder – overrides the default text-input placeholder
 *   disabled    – disables all interactions
 */

import { useRef, useState, useEffect, useCallback, type DragEvent, type ChangeEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, Upload, Image, Film, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { useUploadImage, uploadVideo, useUploadDocument } from '@/lib/api/upload'
import { probeFileDuration, probeVideoDuration } from '@/lib/videoDuration'
import Spinner from '@/components/ui/Spinner'

/* ── Shared styling tokens (match admin dark theme) ── */
const BASE_INPUT =
  'w-full rounded-lg px-3 py-2 text-sm text-white outline-none transition-all placeholder:opacity-30'
const DARK_BG   = 'rgba(0,0,0,0.28)'
const BORDER    = '1px solid rgba(255,255,255,0.09)'
const FOCUS_BORDER = '1px solid rgba(0,87,184,0.65)'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/* ─────────────────────────────────────────────────────────────
   Internal: hidden file input trigger + drag state
───────────────────────────────────────────────────────────── */
interface UseFilePickerOptions {
  accept: string
  onPick: (file: File) => void
}

function useFilePicker({ accept, onPick }: UseFilePickerOptions) {
  const ref = useRef<HTMLInputElement>(null)

  const open = useCallback(() => ref.current?.click(), [])

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onPick(file)
      /* reset so the same file can be re-picked */
      if (ref.current) ref.current.value = ''
    },
    [onPick],
  )

  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      className="sr-only"
      onChange={handleChange}
      tabIndex={-1}
      aria-hidden
    />
  )

  return { open, input }
}

/* ─────────────────────────────────────────────────────────────
   Props
───────────────────────────────────────────────────────────── */
export interface MediaUploadFieldProps {
  value:       string
  onChange:    (url: string) => void
  /* 'document' is images PLUS PDF, uploaded through /uploads/document.
     Kept separate from 'image' because the image endpoint is deliberately
     images-only for avatars and course art. */
  type:        'image' | 'video' | 'document'
  label?:      string
  hint?:       string
  error?:      string
  mode?:       'full' | 'compact'
  placeholder?: string
  disabled?:   boolean
  /* Video only. Fires with the clip's length in SECONDS as soon as the
     browser can read its metadata — from the local file the moment it is
     picked, or from a pasted URL. Lets callers fill a duration field
     instead of asking the admin to measure the video themselves. */
  onDurationDetected?: (seconds: number) => void
}

/* ─────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────── */
export function MediaUploadField({
  value,
  onChange,
  type,
  label,
  hint,
  error,
  mode = 'full',
  placeholder,
  disabled = false,
  onDurationDetected,
}: MediaUploadFieldProps) {
  const [tab,        setTab]        = useState<'url' | 'upload'>('url')
  const [dragging,   setDragging]   = useState(false)
  const [uploadErr,  setUploadErr]  = useState<string | null>(null)
  const [lastFile,   setLastFile]   = useState<{ name: string; size: number } | null>(null)
  const [uploading,    setUploading]    = useState(false)
  const [vidProgress,  setVidProgress]  = useState(0)
  /* Lets the user abort a large upload instead of waiting it out. */
  const abortRef = useRef<AbortController | null>(null)

  const uploadImage = useUploadImage()
  const uploadDoc   = useUploadDocument()
  const isUploading = uploadImage.isPending || uploadDoc.isPending || uploading
  const uploadDone  = !!value && !!lastFile && !isUploading

  const accept = type === 'image'
    ? 'image/jpeg,image/png,image/gif,image/webp'
    : type === 'document'
      /* Mirrors ALLOWED_DOCUMENT on the server exactly. GIF is absent there,
         so it is absent here — an accept list the server disagrees with just
         moves the refusal from the file picker to a failed upload. */
      ? 'application/pdf,image/jpeg,image/png,image/webp'
      : 'video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska'

  /* ── Handle file pick (from either file-input or drop) ── */
  const handleFile = useCallback(async (file: File) => {
    setUploadErr(null)
    setLastFile({ name: file.name, size: file.size })
    try {
      let url: string
      if (type === 'image') {
        url = await uploadImage.mutateAsync(file)
      } else if (type === 'document') {
        url = await uploadDoc.mutateAsync(file)
      } else {
        setUploading(true)
        setVidProgress(0)
        /* Read the length off the local file while the bytes are still
           uploading — costs nothing and means the duration is known before
           the upload even finishes. */
        if (onDurationDetected) {
          void probeFileDuration(file).then(secs => { if (secs) onDurationDetected(secs) })
        }
        const controller = new AbortController()
        abortRef.current = controller
        /* Direct to R2 — the public URL is usable the moment this resolves. */
        url = await uploadVideo(file, (pct) => setVidProgress(pct), { signal: controller.signal })
        setUploading(false)
      }
      onChange(url)
    } catch (err: unknown) {
      setUploading(false)
      /* A user-initiated cancel is not an error — just reset quietly. */
      if ((err as { name?: string })?.name === 'AbortError') {
        setLastFile(null)
        return
      }
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message
        ?? (err instanceof Error ? err.message : 'Upload failed')
      setUploadErr(msg)
      setLastFile(null)
    } finally {
      abortRef.current = null
    }
  }, [type, uploadImage, uploadDoc, onChange, onDurationDetected])

  const cancelUpload = useCallback(() => abortRef.current?.abort(), [])

  /* A pasted/typed video URL should fill the duration too, not just an upload.
     Debounced so it fires once the field settles rather than on every
     keystroke, and skipped while an upload is in flight (that path already
     probed the local file, which is faster and works offline). */
  const lastProbed = useRef<string>('')
  useEffect(() => {
    if (type !== 'video' || !onDurationDetected || uploading) return
    const url = value.trim()
    if (!/^https?:\/\/\S+$/i.test(url) || url === lastProbed.current) return
    const t = setTimeout(() => {
      lastProbed.current = url
      void probeVideoDuration(url).then(secs => { if (secs) onDurationDetected(secs) })
    }, 800)
    return () => clearTimeout(t)
  }, [value, type, uploading, onDurationDetected])

  /* ── Hidden file input ── */
  const { open: openPicker, input: fileInput } = useFilePicker({ accept, onPick: handleFile })

  /* ── Drag handlers ── */
  const onDragOver  = (e: DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = ()             => setDragging(false)
  const onDrop      = (e: DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  /* ── Clear uploaded file ── */
  const clear = () => {
    abortRef.current?.abort()
    onChange('')
    setLastFile(null)
    setUploadErr(null)
    setUploading(false)
    setVidProgress(0)
    uploadImage.reset()
  }

  /* ══════════════════════════════════════════════════
     COMPACT MODE — inline input + clip button
  ══════════════════════════════════════════════════ */
  if (mode === 'compact') {
    return (
      <div className="space-y-1">
        <div className="relative flex items-center gap-1">
          {fileInput}
          <input
            value={value}
            onChange={e => { setLastFile(null); onChange(e.target.value) }}
            placeholder={placeholder ?? (
              type === 'image'    ? 'Image URL or upload ↗'
            : type === 'document' ? 'PDF or image URL, or upload ↗'
            :                       'Video URL or upload ↗')}
            disabled={disabled || isUploading}
            className={`${BASE_INPUT} pr-1`}
            style={{
              background: DARK_BG,
              border: (error || uploadErr) ? '1px solid rgba(239,68,68,0.55)' : BORDER,
            }}
            onFocus={e  => { e.currentTarget.style.border = FOCUS_BORDER }}
            onBlur={e   => { e.currentTarget.style.border = (error || uploadErr) ? '1px solid rgba(239,68,68,0.55)' : BORDER }}
          />
          {/* Upload button */}
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled || isUploading}
            title={`Upload ${type === 'image' ? 'image' : 'video'}`}
            className="flex-shrink-0 flex h-[34px] w-[34px] items-center justify-center rounded-lg transition-all disabled:opacity-40 hover:opacity-80"
            style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.30)', color: '#0057b8' }}
          >
            {isUploading
              ? <Spinner size={13} />
              : <Upload size={13} />}
          </button>
        </div>
        {/* Compact upload progress */}
        {uploading && (
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1"
            style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.18)' }}>
            <Spinner size={10} className="flex-shrink-0" />
            <p className="flex-1 text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {`Uploading… ${vidProgress}%`}
            </p>
            <button type="button" onClick={cancelUpload}
              className="flex-shrink-0 text-[10px] font-semibold transition-opacity hover:opacity-70"
              style={{ color: 'rgba(255,255,255,0.45)' }}>
              Cancel
            </button>
          </div>
        )}
        {/* Compact error display */}
        {(error || uploadErr) && (
          <motion.div initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-1 rounded-md px-2 py-1"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
            <AlertCircle size={10} className="mt-0.5 flex-shrink-0" style={{ color: '#EF4444' }} />
            <p className="text-[10px] leading-snug break-all" style={{ color: '#EF4444' }}>
              {uploadErr ?? error}
            </p>
          </motion.div>
        )}
      </div>
    )
  }

  /* ══════════════════════════════════════════════════
     FULL MODE — tabbed card
  ══════════════════════════════════════════════════ */
  const TypeIcon = type === 'image' ? Image : Film
  const hints = type === 'image'
    ? 'JPG, PNG, GIF, WebP · max 5 MB'
    : 'MP4, WebM, MOV, AVI, MKV · max 2 GB'

  return (
    <div className="space-y-2">
      {fileInput}

      {/* Label */}
      {label && (
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          {hint && <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{hint}</p>}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl p-1"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {(['url', 'upload'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setUploadErr(null) }}
            disabled={disabled}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all"
            style={{
              background: tab === t ? 'rgba(0,87,184,0.18)' : 'transparent',
              color: tab === t ? '#0057b8' : 'rgba(255,255,255,0.45)',
              border: tab === t ? '1px solid rgba(0,87,184,0.30)' : '1px solid transparent',
            }}>
            {t === 'url' ? <Link size={11} /> : <Upload size={11} />}
            {t === 'url' ? 'Paste URL' : 'Upload file'}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <AnimatePresence mode="wait">
        {tab === 'url' ? (
          /* ── URL tab ── */
          <motion.div key="url"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}>
            <div className="relative">
              <Link size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'rgba(255,255,255,0.25)' }} />
              <input
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder ?? (type === 'image' ? 'https://example.com/image.jpg' : 'https://example.com/video.mp4')}
                disabled={disabled}
                className={`${BASE_INPUT} pl-9`}
                style={{
                  background: DARK_BG,
                  border: error ? '1px solid rgba(239,68,68,0.55)' : BORDER,
                }}
                onFocus={e => { e.currentTarget.style.border = FOCUS_BORDER }}
                onBlur={e  => { e.currentTarget.style.border = error ? '1px solid rgba(239,68,68,0.55)' : BORDER }}
              />
            </div>
          </motion.div>
        ) : (
          /* ── Upload tab ── */
          <motion.div key="upload"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2">

            {/* Drop zone */}
            {!uploadDone && !isUploading && (
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={disabled ? undefined : openPicker}
                className="flex flex-col items-center gap-2 rounded-xl py-6 transition-all cursor-pointer"
                style={{
                  border: `1.5px dashed ${dragging ? '#0057b8' : 'rgba(255,255,255,0.12)'}`,
                  background: dragging ? 'rgba(0,87,184,0.06)' : 'rgba(255,255,255,0.02)',
                }}>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl"
                  style={{ background: 'rgba(0,87,184,0.10)', border: '1px solid rgba(0,87,184,0.20)' }}>
                  <TypeIcon size={20} style={{ color: '#0057b8' }} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>
                    Drag & drop or{' '}
                    <span style={{ color: '#0057b8' }}>browse</span>
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{hints}</p>
                </div>
              </div>
            )}

            {/* Uploading state */}
            {uploading && (
              <div className="space-y-2 rounded-xl px-4 py-3"
                style={{ background: 'rgba(0,87,184,0.07)', border: '1px solid rgba(0,87,184,0.18)' }}>
                <div className="flex items-center gap-3">
                  <Spinner size={16} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
                      Uploading {lastFile?.name}…
                    </p>
                    <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {`${lastFile ? humanSize(lastFile.size) : ''} · ${vidProgress}%`}
                    </p>
                  </div>
                  <button type="button" onClick={cancelUpload}
                    className="flex-shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold transition-opacity hover:opacity-70"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' }}>
                    Cancel
                  </button>
                </div>
                {/* Upload progress bar */}
                <div className="h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg,#0057b8,#003d80)' }}
                    animate={{ width: `${vidProgress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            )}

            {/* Success state */}
            {uploadDone && !isUploading && (
              <div className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.20)' }}>
                <CheckCircle2 size={16} className="flex-shrink-0" style={{ color: '#4ADE80' }} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    {lastFile?.name}
                  </p>
                  <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {lastFile ? humanSize(lastFile.size) : ''} · uploaded
                  </p>
                </div>
                <button type="button" onClick={clear}
                  className="flex-shrink-0 rounded-md p-0.5 transition-colors hover:bg-white/10"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                  title="Remove file">
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Re-pick after success */}
            {uploadDone && !isUploading && (
              <button type="button" onClick={openPicker} disabled={disabled}
                className="w-full rounded-lg py-1.5 text-xs font-semibold transition-all hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                Replace file
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image preview (URL tab, valid URL) */}
      {type === 'image' && value && tab === 'url' && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="overflow-hidden rounded-xl"
          style={{ maxWidth: 280, border: '1px solid rgba(255,255,255,0.07)' }}>
          <img src={value} alt="Preview" className="w-full object-cover" />
        </motion.div>
      )}

      {/* Uploaded image preview */}
      {type === 'image' && value && uploadDone && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="overflow-hidden rounded-xl"
          style={{ maxWidth: 280, border: '1px solid rgba(255,255,255,0.07)' }}>
          <img src={value} alt="Preview" className="w-full object-cover" />
        </motion.div>
      )}

      {/* Error */}
      {(error || uploadErr) && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-1.5 text-xs"
          style={{ color: '#EF4444' }}>
          <AlertCircle size={12} />
          {uploadErr ?? error}
        </motion.div>
      )}
    </div>
  )
}
