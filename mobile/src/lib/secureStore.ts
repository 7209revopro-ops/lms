import * as SecureStore from 'expo-secure-store'
import type { SessionTokens } from '@shared'

/* ─────────────────────────────────────────────────────────────
   Everything the app must keep secret lives in the Keychain (iOS) /
   Keystore (Android) — never AsyncStorage, never logs (plan.md §13.9).

   THIS_DEVICE_ONLY: a session and a device id belong to this phone. Restoring
   a backup onto a new phone must not carry them over — the new phone is a new
   device for the admin to approve, exactly like a new browser.
───────────────────────────────────────────────────────────── */

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

const KEY = {
  access:   'lms.session.access',
  refresh:  'lms.session.refresh',
  deviceId: 'lms.device.id',
} as const

export async function readTokens(): Promise<SessionTokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(KEY.access, OPTS),
    SecureStore.getItemAsync(KEY.refresh, OPTS),
  ])
  return accessToken && refreshToken ? { accessToken, refreshToken } : null
}

export async function writeTokens(t: SessionTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY.access, t.accessToken, OPTS),
    SecureStore.setItemAsync(KEY.refresh, t.refreshToken, OPTS),
  ])
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY.access, OPTS),
    SecureStore.deleteItemAsync(KEY.refresh, OPTS),
  ])
}

/* The device id is NOT cleared on sign-out: it identifies the phone, not the
   session — the same rule as the browser's lms_device cookie. */
export const readDeviceId  = () => SecureStore.getItemAsync(KEY.deviceId, OPTS)
export const writeDeviceId = (id: string) => SecureStore.setItemAsync(KEY.deviceId, id, OPTS)

/* The Expo push token this phone last registered — kept so sign-out (or a
   lost session) can tell the server to stop pushing here. */
const PUSH_KEY = 'lms.push.token'
export const readPushToken  = () => SecureStore.getItemAsync(PUSH_KEY, OPTS)
export const writePushToken = (t: string) => SecureStore.setItemAsync(PUSH_KEY, t, OPTS)
export const clearPushToken = () => SecureStore.deleteItemAsync(PUSH_KEY, OPTS)
