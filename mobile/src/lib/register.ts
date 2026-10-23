import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { isValidPhoneNumber } from 'libphonenumber-js'
import {
  AVATAR_MAX_BYTES, AVATAR_MAX_DIMENSION, DOC_MAX_BYTES, DOC_MAX_DIMENSION, problemOf, type ApiSuccess,
} from '@shared'
import { http } from './http'
import i18n from '@/i18n'

/* ─────────────────────────────────────────────────────────────
   Registration plumbing — the website's lib/signupUpload.ts and
   imageCompression.ts, for a phone:

   · Photos are ALWAYS re-encoded as JPEG and shrunk (longest edge 1920 for
     documents, 1024 for the profile photo). That also turns an iPhone's HEIC
     into something the server accepts — the website has to refuse HEIC and
     send the student to Settings; the app just converts it.
   · PDFs go as they are, within the 3 MB the server allows.
   · Uploads happen before the account exists (POST /uploads/signup-doc, no
     session), one at a time, each with a 45 s deadline and one retry when
     no answer came back at all. A retry of Submit does not upload a file that
     already went through.
───────────────────────────────────────────────────────────── */

export const phoneOk = (v: string) => { try { return isValidPhoneNumber(v) } catch { return false } }

/** A file chosen on the phone, ready to upload. */
export interface PreparedFile { uri: string; name: string; mimeType: string; size: number }

async function sizeOf(uri: string): Promise<number> {
  return (await (await fetch(uri)).blob()).size
}

/** Shrink and re-encode a photo until it fits `maxBytes` (or give up at the
 *  lowest quality and let the size check refuse it). */
export async function preparePhoto(uri: string, kind: 'avatar' | 'doc', name = 'photo.jpg'): Promise<PreparedFile> {
  const maxDim = kind === 'avatar' ? AVATAR_MAX_DIMENSION : DOC_MAX_DIMENSION
  const maxBytes = kind === 'avatar' ? AVATAR_MAX_BYTES : DOC_MAX_BYTES
  const probe = await ImageManipulator.manipulate(uri).renderAsync()
  const scale = Math.max(probe.width, probe.height) > maxDim
  let last: PreparedFile | null = null
  for (const compress of [0.82, 0.65, 0.5]) {
    const ctx = ImageManipulator.manipulate(uri)
    if (scale) ctx.resize(probe.width >= probe.height ? { width: maxDim } : { height: maxDim })
    const out = await (await ctx.renderAsync()).saveAsync({ compress, format: SaveFormat.JPEG })
    last = { uri: out.uri, name: name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg', size: await sizeOf(out.uri) }
    if (last.size <= maxBytes) return last
  }
  return last!
}

const ATTEMPT_TIMEOUT_MS = 45_000
const RETRY_DELAY_MS = 1_200
const uploaded = new Map<string, string>()

/** Upload one signup document; returns the server's reference. */
export function uploadSignupDoc(f: PreparedFile, kind: 'kyc' | 'photo', label: string): Promise<string> {
  return upload(f, '/uploads/signup-doc', label, kind)
}

/** Upload a document from a signed-in account (completing the registration):
 *  identity scans to private storage, the photo to documents. */
export function uploadAccountDoc(f: PreparedFile, kind: 'kyc' | 'photo', label: string): Promise<string> {
  return upload(f, kind === 'kyc' ? '/uploads/kyc' : '/uploads/document', label)
}

async function upload(f: PreparedFile, path: string, label: string, kind?: string): Promise<string> {
  const cached = uploaded.get(f.uri)
  if (cached) return cached
  for (let attempt = 1; ; attempt++) {
    const form = new FormData()
    form.append('file', { uri: f.uri, name: f.name, type: f.mimeType } as unknown as Blob)
    if (kind) form.append('kind', kind)
    try {
      const res = await http.post<ApiSuccess<{ url?: string }>>(path, form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: ATTEMPT_TIMEOUT_MS,
      })
      const url = res.data.data.url
      if (!url) throw new Error(i18n.t('register.uploadNoRef', { label }))
      uploaded.set(f.uri, url)
      return url
    } catch (err) {
      const p = problemOf(err)
      /* Only a request that got no answer is retried; a refusal is final. */
      if (p.kind !== 'refused' && attempt < 2) { await new Promise(r => setTimeout(r, RETRY_DELAY_MS)); continue }
      if (p.kind === 'refused') throw new Error(i18n.t('register.uploadRefused', { label, why: p.message }))
      throw new Error(i18n.t('register.uploadDropped', { label }))
    }
  }
}

/** A file is forgotten once the student replaces or removes it. */
export function forgetUpload(uri: string): void {
  uploaded.delete(uri)
}
