'use client'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* ── Types ─────────────────────────────────────────────────── */
export interface UploadImageResult {
  url:  string
  key:  string
  size: number
}

export interface PresignResult {
  presignedUrl: string
  publicUrl:    string
  key:          string
}

/* Client-side ceiling. Advisory only — a presigned PUT is signed before the
   bytes exist, so the real enforcement is R2's own 5 GB single-PUT limit.
   This exists to fail fast in the UI instead of after a long upload. */
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024   // 2 GB

/* Mirrors backend ALLOWED_VIDEO (middleware/upload.middleware.ts) */
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4:  'video/mp4',
  m4v:  'video/mp4',
  webm: 'video/webm',
  mov:  'video/quicktime',
  avi:  'video/x-msvideo',
  mkv:  'video/x-matroska',
}

/* The browser leaves `file.type` EMPTY for some containers (.mkv and .avi are
   the usual offenders, and any file whose extension the OS doesn't know).
   An empty type fails presign validation, and — worse — a type that differs
   between signing and PUT makes R2 reject the upload with
   SignatureDoesNotMatch, which surfaces as an opaque CORS error. So resolve
   it ONCE here and use the same value for both calls. */
export function resolveVideoContentType(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mapped = VIDEO_MIME_BY_EXT[ext]
  if (mapped) return mapped
  throw new Error(
    `Could not identify "${file.name}" as a video. Supported formats: MP4, WebM, MOV, AVI, MKV.`,
  )
}

/* ── Image: backend receives file → uploads to R2 → returns CDN URL ── */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ success: true; data: UploadImageResult }>(
    '/uploads/image',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return res.data.data.url
}

/* ── Document upload (images AND PDF) ─────────────────────────────────────
   A different endpoint from uploadImage, not a wider filter on that one.
   /uploads/image is deliberately images-only and is used by avatars,
   thumbnails and course art, where a PDF would be a mistake rather than a
   feature. /uploads/document already accepted PDFs for enrollment paperwork:
   10 MB, magic-byte verified against %PDF so a renamed file is refused, and
   written under the `documents/` prefix, which the public asset proxy serves
   (only `videos/` and `kyc/` are blocked there). That last part is what makes
   it the right endpoint for a lesson resource: a student has to be able to
   open it. */
export async function uploadDocument(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ success: true; data: UploadImageResult }>(
    '/uploads/document',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return res.data.data.url
}

/* ── Presign: backend returns PUT URL → client uploads directly to R2 ── */
export async function getPresignedUrl(
  filename:    string,
  contentType: string,
  folder = 'uploads',
): Promise<PresignResult> {
  const res = await api.post<{ success: true; data: PresignResult }>(
    '/uploads/presign',
    { filename, contentType, folder },
  )
  return res.data.data
}

/* ── Upload a file directly to R2 via presigned URL (with progress) ──
   Raw File as the body — never FormData: a presigned PUT stores the request
   body verbatim, so a multipart wrapper would corrupt the object. No
   Authorization header either; the signature in the query string is the
   credential, and an extra auth header makes R2 reject the request. */
export async function uploadToR2Direct(
  presignedUrl: string,
  file:         File,
  onProgress?:  (pct: number) => void,
  opts?:        { contentType?: string; signal?: AbortSignal },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presignedUrl)
    /* MUST be byte-identical to the Content-Type that was signed */
    xhr.setRequestHeader('Content-Type', opts?.contentType ?? file.type)

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      })
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(100); resolve() }
      else if (xhr.status === 403) {
        reject(new Error('Storage rejected the upload (link expired or file type changed). Please try again.'))
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status}). Please try again.`))
      }
    })
    xhr.addEventListener('error', () => reject(new Error(
      'Network error during upload. Check your connection and try again.',
    )))
    xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')))

    if (opts?.signal) {
      if (opts.signal.aborted) { xhr.abort(); return }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(file)
  })
}

/* ── Multipart upload — the path large files take ────────────
   A single PUT of a 500 MB file is one HTTP request held open for many
   minutes; one blip on the uploader's connection fails the entire transfer
   with an opaque "network error" and no way to resume. Splitting the file
   into parts means a blip costs one 8 MB chunk, which is retried on its own.

   Parts upload with a small concurrency window: enough to keep the pipe
   full, few enough that the per-part progress still moves smoothly and a
   home connection is not saturated by a dozen parallel streams. ── */
const PART_SIZE       = 8 * 1024 * 1024   // 8 MB — well over S3's 5 MB minimum
const MULTIPART_ABOVE = 16 * 1024 * 1024  // below this a single PUT is simpler and faster
const PART_CONCURRENCY = 3
const PART_ATTEMPTS    = 3

interface MultipartInit { key: string; uploadId: string }

async function putPart(
  url: string, blob: Blob, signal?: AbortSignal,
  onDelta?: (bytes: number) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    let counted = 0
    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable || !onDelta) return
      onDelta(e.loaded - counted)      // report the delta so the caller can total it
      counted = e.loaded
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        /* R2 returns the part's ETag; CompleteMultipartUpload needs it verbatim.
           Requires `ExposeHeaders: [ETag]` in the bucket CORS policy. */
        const etag = xhr.getResponseHeader('ETag')
        if (!etag) { reject(new Error('ETAG_MISSING')); return }
        resolve(etag)
      } else reject(new Error(`part failed (HTTP ${xhr.status})`))
    })
    xhr.addEventListener('error', () => reject(new Error('part network error')))
    xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')))
    if (signal) {
      if (signal.aborted) { xhr.abort(); return }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(blob)
  })
}

async function uploadMultipart(
  file: File, contentType: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const init = await api.post<{ success: true; data: MultipartInit }>(
    '/uploads/multipart/create',
    { filename: file.name, contentType, folder: 'videos' },
  ).then(r => r.data.data)

  const total      = file.size
  const partCount  = Math.ceil(total / PART_SIZE)
  const numbers    = Array.from({ length: partCount }, (_, i) => i + 1)

  try {
    const signed = await api.post<{ success: true; data: { urls: { partNumber: number; url: string }[] } }>(
      '/uploads/multipart/sign',
      { key: init.key, uploadId: init.uploadId, partNumbers: numbers },
    ).then(r => r.data.data.urls)
    const urlByPart = new Map(signed.map(s => [s.partNumber, s.url]))

    let sent = 0
    const bump = (delta: number) => {
      sent += delta
      onProgress?.(Math.min(99, Math.round((sent / total) * 100)))
    }

    const parts: { partNumber: number; eTag: string }[] = []
    let cursor = 0
    const worker = async () => {
      while (cursor < numbers.length) {
        if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')
        const n    = numbers[cursor++]!
        const blob = file.slice((n - 1) * PART_SIZE, Math.min(n * PART_SIZE, total))
        let lastErr: unknown
        for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
          try {
            const eTag = await putPart(urlByPart.get(n)!, blob, signal, bump)
            parts.push({ partNumber: n, eTag })
            lastErr = null
            break
          } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') throw err
            lastErr = err
            /* the bytes from the failed attempt never landed — don't count them */
            sent = Math.max(0, sent - blob.size)
            await new Promise(r => setTimeout(r, 400 * attempt))
          }
        }
        if (lastErr) throw lastErr
      }
    }
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker))

    const done = await api.post<{ success: true; data: { publicUrl: string } }>(
      '/uploads/multipart/complete',
      { key: init.key, uploadId: init.uploadId, parts },
    ).then(r => r.data.data)
    onProgress?.(100)
    return done.publicUrl
  } catch (err) {
    /* Leave no half-finished object behind, then surface the real cause. */
    void api.post('/uploads/multipart/abort', { key: init.key, uploadId: init.uploadId }).catch(() => {})
    throw err
  }
}

/* ── Video: presigned direct upload to R2 ────────────────────
   The upload IS the whole pipeline: the MP4/WebM is served straight from the
   CDN and the player streams it with HTTP range requests, so seeking works
   without an HLS ladder. Server-side transcoding (a blocking FFmpeg job,
   ~13 s for a small file and capped at 2 concurrent jobs) has been removed
   from the product entirely — the video is ready the instant the PUT returns.

   Lessons created before that removal still hold master.m3u8 URLs; those
   objects remain in the bucket and keep playing, so both forms coexist. ── */
export async function uploadVideo(
  file:        File,
  onProgress?: (pct: number) => void,
  opts?:       { signal?: AbortSignal },
): Promise<string> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB — the maximum is 2 GB.`,
    )
  }
  const contentType = resolveVideoContentType(file)

  /* Anything sizeable goes up in retryable chunks; small clips keep the
     simpler single request. */
  if (file.size > MULTIPART_ABOVE) {
    return uploadMultipart(file, contentType, onProgress, opts?.signal)
  }

  const result = await getPresignedUrl(file.name, contentType, 'videos')
  await uploadToR2Direct(result.presignedUrl, file, onProgress, { contentType, signal: opts?.signal })
  return result.publicUrl
}

/* ── React Query hooks ── --*/
export function useUploadImage() {
  return useMutation({
    mutationFn: (file: File) => uploadImage(file),
  })
}

export function useUploadDocument() {
  return useMutation({
    mutationFn: (file: File) => uploadDocument(file),
  })
}

export function useUploadVideo(onProgress?: (pct: number) => void) {
  return useMutation({
    mutationFn: (file: File) => uploadVideo(file, onProgress),
  })
}
