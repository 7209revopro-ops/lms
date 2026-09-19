import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authenticate, authenticateAny, requireAnyAdmin, requireInstructor } from '@/middleware/auth.middleware.ts'
import { signupUploadRateLimit } from '@/middleware/rateLimit.middleware.ts'
import {
  imageUpload,
  documentUpload,
  signupDocumentUpload,
  verifyFileSignature,
  safeUploadName,
  ALLOWED_IMAGE,
  ALLOWED_DOCUMENT,
  ALLOWED_VIDEO,
} from '@/middleware/upload.middleware.ts'
import { sendSuccess }     from '@/utils/response.ts'
import {
  uploadFile,
  uploadKycFile,
  uploadToR2,
  generatePresignedPutUrl,
  deleteFromR2,
  makeKey,
  isR2Configured,
  createMultipartUpload,
  signUploadParts,
  completeMultipartUpload,
  abortMultipartUpload,
} from '@/services/r2.service.ts'

const router = Router()

/* ── POST /uploads/signup-doc ────────────────────────────────
   The ONE upload with no session behind it, and the only route in this file
   mounted above the authenticateAny line below.

   Why it has to exist (M-05): the full signup form collects a passport, an ID
   document and a profile photo. Those used to be uploaded AFTER /auth/register
   using the session register hands back — which is exactly what
   SIGNUP_REQUIRE_VERIFICATION takes away. With verification required, all
   three uploads and both profile patches would 401 and every full signup would
   silently lose its documents. Uploading first, then passing the returned
   references in the register payload, removes that dependency: registration
   becomes a single request that needs no session before or after it.

   The register endpoint itself is deliberately left alone — still JSON, still
   the same schema, and above all still the same response time on both the
   taken-email and new-email paths. Carrying the files inside register would
   have re-opened M-05 from the other end: file writes only happen for a new
   address, so registering with 9 MB attached would answer seconds slower for a
   fresh email than a taken one — a far louder oracle than the 250 ms bcrypt
   gap that finding started with.

   Bounded by: its own hourly limiter (45/hour — fifteen complete signups,
   see signupUploadRateLimit; this said 9 long after the number moved), a 3 MB cap, the same magic-byte check every other upload gets, and
   a `kind` that selects between the private KYC prefix and the public one.
   Identity scans still land under `kyc/`, unreadable without going through
   GET /documents/:userId/:field.
────────────────────────────────────────────────────────────── */
router.post(
  '/signup-doc',
  signupUploadRateLimit,
  (req: Request, res: Response, next: NextFunction) => {
    signupDocumentUpload.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({
          success: false,
          error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
        })
        return
      }
      next()
    })
  },
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No file provided. Use the "file" field.' },
      })
      return
    }

    if (!verifyFileSignature(req.file.buffer, req.file.mimetype)) {
      res.status(400).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'File contents do not match the declared document type.' },
      })
      return
    }

    /* Anything that is not explicitly the public profile photo is treated as an
       identity scan. Defaulting the other way would put a passport in the
       public bucket on a typo — and `kind` is a repeatable multipart field, so
       `kind=photo&kind=x` arrives as an array and lands here as `false`, which
       is the safe direction. */
    const isPhoto = req.body?.kind === 'photo'

    /* The avatar is the one thing this route stores PUBLICLY, so it gets the
       image allow-list rather than the document one. The shared documentUpload
       filter permits application/pdf, which is right for a passport and wrong
       for something rendered as an <img> from our own origin. */
    if (isPhoto && !ALLOWED_IMAGE.has(req.file.mimetype)) {
      res.status(400).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'A profile photo must be a JPEG, PNG, GIF or WebP image.' },
      })
      return
    }

    try {
      if (isPhoto) {
        const key = makeKey(safeUploadName(req.file.mimetype), 'documents')
        const url = await uploadFile(req.file.buffer, key, req.file.mimetype)
        sendSuccess(res, { url, key, size: req.file.size }, undefined, 201)
        return
      }
      const key    = makeKey(safeUploadName(req.file.mimetype), 'kyc')
      const stored = await uploadKycFile(req.file.buffer, key, req.file.mimetype)
      sendSuccess(res, { url: stored, key: stored, size: req.file.size }, undefined, 201)
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
      })
    }
  },
)

/* ── Every remaining upload route requires a valid session (student or admin) ── */
router.use(authenticateAny)

/* ── POST /uploads/image ─────────────────────────────────────
   Accepts: multipart/form-data with field "file"
   Accepts: JPEG, PNG, GIF, WebP — max 5 MB
   Flow:    multer (memoryStorage) → uploadToR2 → return CDN URL
   Returns: { url, key, size }
────────────────────────────────────────────────────────────── */
router.post(
  '/image',
  (req: Request, res: Response, next: NextFunction) => {
    imageUpload.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({
          success: false,
          error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
        })
        return
      }
      next()
    })
  },
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No file was uploaded. Use the "file" field in your multipart form.' },
      })
      return
    }

    if (!verifyFileSignature(req.file.buffer, req.file.mimetype)) {
      res.status(400).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'File contents do not match the declared image type.' },
      })
      return
    }

    try {
      const key = makeKey(safeUploadName(req.file.mimetype), 'images')
      const url = await uploadFile(req.file.buffer, key, req.file.mimetype)
      sendSuccess(res, { url, key, size: req.file.size }, undefined, 201)
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
      })
    }
  },
)

/* ── POST /uploads/document ──────────────────────────────────
   Enrollment form documents — accepts JPEG, PNG, WebP, PDF (10 MB).
   Returns: { url, key, size }
────────────────────────────────────────────────────────────── */
router.post(
  '/document',
  (req: Request, res: Response, next: NextFunction) => {
    documentUpload.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({
          success: false,
          error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
        })
        return
      }
      next()
    })
  },
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No file provided. Use the "file" field.' },
      })
      return
    }

    if (!verifyFileSignature(req.file.buffer, req.file.mimetype)) {
      res.status(400).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'File contents do not match the declared document type.' },
      })
      return
    }

    try {
      const key = makeKey(safeUploadName(req.file.mimetype), 'documents')
      const url = await uploadFile(req.file.buffer, key, req.file.mimetype)
      sendSuccess(res, { url, key, size: req.file.size }, undefined, 201)
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
      })
    }
  },
)

/* ── POST /uploads/kyc ───────────────────────────────────────
   Identity scans (passport, national ID). Same accepted types as /document,
   but written under the `kyc/` prefix, which is never served publicly — see
   H-11. Read them back through GET /documents/:userId/:field.

   Deliberately NOT used for the profile photo: that doubles as the user's
   avatar and is rendered in ~47 places across both apps, so it stays public.
────────────────────────────────────────────────────────────── */
router.post(
  '/kyc',
  (req: Request, res: Response, next: NextFunction) => {
    documentUpload.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({
          success: false,
          error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
        })
        return
      }
      next()
    })
  },
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No file provided. Use the "file" field.' },
      })
      return
    }

    if (!verifyFileSignature(req.file.buffer, req.file.mimetype)) {
      res.status(400).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'File contents do not match the declared document type.' },
      })
      return
    }

    try {
      const key = makeKey(safeUploadName(req.file.mimetype), 'kyc')
      /* Returns the bare KEY, not a URL — identity scans are never addressable
         without going through GET /documents/:userId/:field. */
      const stored = await uploadKycFile(req.file.buffer, key, req.file.mimetype)
      sendSuccess(res, { url: stored, key: stored, size: req.file.size }, undefined, 201)
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: (err as Error).message },
      })
    }
  },
)

/* ── POST /uploads/presign ───────────────────────────────────
   For large files (videos, PDFs) — client uploads directly to R2.
   Body: { filename: string, contentType: string, folder?: UploadFolder }
   Returns: { presignedUrl, publicUrl, key }
   The client PUTs the file to presignedUrl, then stores publicUrl.
────────────────────────────────────────────────────────────── */
/* ── Presigned-upload allow-lists ────────────────────────────
   A presigned PUT is an arbitrary-object write on the CDN
   origin, so both the destination folder and the Content-Type
   are restricted to a known set.
────────────────────────────────────────────────────────────── */
const UPLOAD_FOLDERS = ['images', 'documents', 'videos', 'uploads'] as const
type UploadFolder = (typeof UPLOAD_FOLDERS)[number]

const ALLOWED_BY_FOLDER: Record<UploadFolder, Set<string>> = {
  images:    ALLOWED_IMAGE,
  documents: ALLOWED_DOCUMENT,
  videos:    ALLOWED_VIDEO,
  uploads:   new Set([...ALLOWED_IMAGE, ...ALLOWED_DOCUMENT, ...ALLOWED_VIDEO]),
}

/* Script-bearing types are never acceptable, whatever the folder */
const DENIED_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/x-httpd-php',
])

function isAllowedType(folder: UploadFolder, contentType: string): boolean {
  const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase()
  if (DENIED_TYPES.has(mime)) return false
  return ALLOWED_BY_FOLDER[folder].has(mime)
}

const presignBody = z.object({
  filename:    z.string().min(1),
  contentType: z.string().min(1),
  folder:      z.enum(UPLOAD_FOLDERS).default('uploads'),
})

/* requireInstructor (P-15). A presigned PUT is an arbitrary-object write on the
   production media bucket with a 1-hour window and no quantity cap — an
   authoring capability, not a student one. It used to sit behind
   authenticateAny alone, so any signed-up viewer who had paid nothing could
   mint unlimited upload URLs into videos/, documents/ and uploads/.

   Verified no student flow depends on it: the only client caller is
   components/ui/FileUpload.tsx, which nothing renders — the enrolment form in
   RequestSection.tsx defines its own local FileUpload and posts directly to
   /uploads/image, /uploads/document and /uploads/kyc, all of which stay open
   to students and are size-capped and magic-byte verified. */
router.post('/presign', requireInstructor, async (req: Request, res: Response) => {
  if (!isR2Configured()) {
    res.status(503).json({ success: false, error: { code: 'R2_NOT_CONFIGURED', message: 'Cloud storage is not configured. Use the direct upload endpoint instead.' } })
    return
  }
  const parsed = presignBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Validation error' },
    })
    return
  }

  const { filename, contentType, folder } = parsed.data

  // Validate the MIME type against the allow-list for that folder
  if (!isAllowedType(folder, contentType)) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_TYPE', message: `This file type is not allowed in the ${folder} folder` },
    })
    return
  }

  try {
    const key    = makeKey(filename, folder)
    const result = await generatePresignedPutUrl(key, contentType)
    sendSuccess(res, result, undefined, 201)
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'R2_ERROR', message: (err as Error).message },
    })
  }
})

/* ── Multipart upload (large videos) ─────────────────────────
   Four small JSON calls that bracket a browser-driven chunked upload:

     create   → mint an uploadId for a new object
     sign     → presign a batch of part URLs
     complete → assemble the parts into the final object
     abort    → discard a cancelled/failed upload so no partial data lingers

   Bytes never pass through this server; only signatures and the part list.
   Same gate as /presign (P-15): an authoring capability, not a student one.
────────────────────────────────────────────────────────────── */
const multipartCreateBody = z.object({
  filename:    z.string().min(1),
  contentType: z.string().min(1),
  folder:      z.enum(UPLOAD_FOLDERS).default('uploads'),
})

router.post('/multipart/create', requireInstructor, async (req: Request, res: Response) => {
  if (!isR2Configured()) {
    res.status(503).json({ success: false, error: { code: 'R2_NOT_CONFIGURED', message: 'Cloud storage is not configured.' } })
    return
  }
  const parsed = multipartCreateBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Validation error' } })
    return
  }
  const { filename, contentType, folder } = parsed.data
  if (!isAllowedType(folder, contentType)) {
    res.status(400).json({ success: false, error: { code: 'INVALID_TYPE', message: `This file type is not allowed in the ${folder} folder` } })
    return
  }
  try {
    const key = makeKey(filename, folder)
    const { uploadId } = await createMultipartUpload(key, contentType)
    sendSuccess(res, { key, uploadId }, undefined, 201)
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'R2_ERROR', message: (err as Error).message } })
  }
})

/* Part numbers are capped at S3's 10 000 limit, and a batch is bounded so one
   request cannot ask the signer for an unbounded amount of work. */
const multipartSignBody = z.object({
  key:         z.string().min(1),
  uploadId:    z.string().min(1),
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(1_000),
})

router.post('/multipart/sign', requireInstructor, async (req: Request, res: Response) => {
  const parsed = multipartSignBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Validation error' } })
    return
  }
  try {
    const urls = await signUploadParts(parsed.data.key, parsed.data.uploadId, parsed.data.partNumbers)
    sendSuccess(res, { urls })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'R2_ERROR', message: (err as Error).message } })
  }
})

const multipartCompleteBody = z.object({
  key:      z.string().min(1),
  uploadId: z.string().min(1),
  parts:    z.array(z.object({
    partNumber: z.number().int().min(1).max(10_000),
    eTag:       z.string().min(1),
  })).min(1).max(10_000),
})

router.post('/multipart/complete', requireInstructor, async (req: Request, res: Response) => {
  const parsed = multipartCompleteBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Validation error' } })
    return
  }
  try {
    const publicUrl = await completeMultipartUpload(parsed.data.key, parsed.data.uploadId, parsed.data.parts)
    sendSuccess(res, { publicUrl, key: parsed.data.key }, undefined, 201)
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'R2_ERROR', message: (err as Error).message } })
  }
})

router.post('/multipart/abort', requireInstructor, async (req: Request, res: Response) => {
  const parsed = z.object({ key: z.string().min(1), uploadId: z.string().min(1) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'key and uploadId are required' } })
    return
  }
  try {
    await abortMultipartUpload(parsed.data.key, parsed.data.uploadId)
    sendSuccess(res, { aborted: true })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'R2_ERROR', message: (err as Error).message } })
  }
})

/* ── POST /uploads/video (convenience alias) ─────────────────
   Same as /presign with folder=videos.
   Body: { filename: string, contentType: string }
   Returns: { presignedUrl, publicUrl, key }
────────────────────────────────────────────────────────────── */
/* Alias for /presign with folder=videos — same gate (P-15). */
router.post('/video', requireInstructor, async (req: Request, res: Response) => {
  const parsed = z.object({
    filename:    z.string().min(1),
    contentType: z.string().min(1),
  }).safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Validation error' },
    })
    return
  }

  const { filename, contentType } = parsed.data

  if (!isAllowedType('videos', contentType)) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_TYPE', message: 'Only MP4, WebM, QuickTime, AVI or MKV videos are allowed' },
    })
    return
  }

  try {
    const key    = makeKey(filename, 'videos')
    const result = await generatePresignedPutUrl(key, contentType)
    sendSuccess(res, result, undefined, 201)
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'R2_ERROR', message: (err as Error).message },
    })
  }
})

/* ── DELETE /uploads/:key ────────────────────────────────────
   Deletes an object from R2 by its key.
   Param: key — URL-encoded R2 object key (e.g. images/1234-abc.jpg)
   Returns: { deleted: true }
────────────────────────────────────────────────────────────── */
/* `hls/` is retained even though nothing writes there any more: lessons created
   before video transcoding was removed still point at hls/…/master.m3u8, and
   those objects must stay deletable when such a lesson is cleaned up. */
const DELETABLE_PREFIXES = ['images/', 'documents/', 'videos/', 'hls/', 'uploads/']

router.delete('/:key(*)', requireAnyAdmin, async (req: Request, res: Response) => {
  const key = Array.isArray(req.params['key']) ? req.params['key'][0] : req.params['key']
  if (!key) {
    res.status(400).json({
      success: false,
      error: { code: 'NO_KEY', message: 'Provide the R2 object key in the URL path.' },
    })
    return
  }

  if (key.includes('..') || !DELETABLE_PREFIXES.some(prefix => key.startsWith(prefix))) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_KEY', message: 'Only media objects under images/, documents/, videos/, hls/ or uploads/ can be deleted.' },
    })
    return
  }

  try {
    await deleteFromR2(key)
    sendSuccess(res, { deleted: true, key })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'R2_ERROR', message: (err as Error).message },
    })
  }
})

export default router
