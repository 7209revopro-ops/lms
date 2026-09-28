/* ─────────────────────────────────────────────────────────────────────────
   Compressing a signup photo before it ever reaches the upload queue.

   A phone's main camera routinely produces 4-15 MB JPEGs (or HEIC, handled
   separately by fileTypeProblem() before this ever runs). The old behaviour
   was a hard rejection — "Profile photo must not exceed 3 MB" — with no path
   forward except leaving the form to find a compression app and come back.
   For a signup flow that is mostly completed on the phone that took the
   photo, that is a real, avoidable drop-off point, not a minor annoyance.

   browser-image-compression runs the actual re-encode in a Web Worker so it
   never blocks the main thread — the form stays responsive while a large
   photo is being shrunk. It is the same class of tool used by most
   production upload flows for exactly this problem, rather than a hand-
   rolled canvas resize that would need to reinvent EXIF-orientation
   handling, memory limits on iOS Safari, and worker fallback.
   ───────────────────────────────────────────────────────────────────────── */
import imageCompression from 'browser-image-compression'

/* Long-edge cap. An ID photo or passport scan reviewed on an admin screen
   never needs more than this — a 4000px camera photo carries pixels nobody
   downstream reads, only bytes the student's upload has to carry. */
const MAX_DIMENSION = 1920

/**
 * Shrink an oversized image client-side so it fits under `maxBytes` before
 * upload. Non-image files (PDFs) and images already under the limit pass
 * through untouched — compression is a courtesy for the one case it helps,
 * not a universal re-encode.
 *
 * Never throws: if compression fails for any reason (an image format the
 * library can't decode, a worker that didn't start), the original file is
 * returned and the caller's existing size check rejects it exactly as
 * before — this can only make an oversized photo MORE likely to succeed,
 * never less likely than the pre-compression behaviour.
 */
export async function compressImageIfNeeded(file: File, maxBytes: number): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= maxBytes) return file

  try {
    return await imageCompression(file, {
      maxSizeMB:        maxBytes / (1024 * 1024),
      maxWidthOrHeight: MAX_DIMENSION,
      useWebWorker:     true,
      /* A starting point, not a promise — the library iterates quality down
         until it's under maxSizeMB or gives up, so this only saves it a pass
         on the common case (a photo that's 2-4x over the limit). */
      initialQuality:   0.82,
    })
  } catch {
    return file
  }
}
