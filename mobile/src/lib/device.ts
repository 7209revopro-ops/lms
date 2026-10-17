import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import { readDeviceId, writeDeviceId } from './secureStore'

/* ─────────────────────────────────────────────────────────────
   This phone's identity for the two-device whitelist (plan.md §13.4 B2):
   32 random bytes, made once, kept in secure storage, sent as X-Device-Id.
   The backend accepts exactly 64 hex characters.
───────────────────────────────────────────────────────────── */

let cached: string | null = null

const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

export async function getDeviceId(): Promise<string> {
  if (cached) return cached
  const stored = await readDeviceId()
  if (stored && /^[a-f0-9]{64}$/.test(stored)) return (cached = stored)
  const id = toHex(await Crypto.getRandomBytesAsync(32))
  await writeDeviceId(id)
  return (cached = id)
}

export const appVersion = Application.nativeApplicationVersion ?? '0.0.0'

/* "DeltaLMS/0.1.0 (Pixel 8; Android 15)" — the backend turns it into the
   label an admin sees on the Devices page: "Delta app · Pixel 8 (Android 15)". */
export function userAgent(): string {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/[;()]/g, ' ').trim()
  const model = clean(Device.modelName) || 'Phone'
  const os = `${clean(Device.osName) || 'Mobile'} ${clean(Device.osVersion)}`.trim()
  return `DeltaLMS/${appVersion} (${model}; ${os})`
}
