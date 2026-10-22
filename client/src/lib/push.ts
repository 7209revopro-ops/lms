'use client'
/* ─────────────────────────────────────────────────────────────
   Phone / desktop notifications (Web Push, 2026-10-21). Once a student allows
   notifications, this browser (or the installed app) is registered with the
   LMS, and every bell notification also arrives as a system notification —
   with the app closed. Shown by public/app-sw.js.

   iPhone: only from the app on the home screen (iOS 16.4+) — Safari in a tab
   has no push. Needs the service worker, which runs in production builds.
───────────────────────────────────────────────────────────── */
import { api } from '@/lib/axios'
import { isIOS, isStandalone } from '@/lib/pwaInstall'

export type PushState = 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on'

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** Where this device stands: needs the app installed (iPhone in Safari), blocked, off, or on. */
export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported'
  if (isIOS() && !isStandalone()) return 'needs-install'
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off'
}

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

/** Subscribe this device and tell the LMS. Asks for permission when it has not been given. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission)
    if (p !== 'granted') return p === 'denied' ? 'blocked' : 'off'
  }
  const key = (await api.get<{ data: { publicKey: string | null } }>('/notifications/push/key')).data.data.publicKey
  if (!key) return 'off'   // push not set up on the server yet
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) })
  await api.post('/notifications/push/subscribe', { subscription: sub.toJSON() })
  return 'on'
}

/* Already allowed (here, or by the Messages page's "Turn on message alerts"): make sure this device is
   registered with the LMS — once per session, quietly. A subscription the browser renewed is re-sent. */
let synced = false
export async function syncPush(): Promise<void> {
  if (synced || !pushSupported() || Notification.permission !== 'granted' || (isIOS() && !isStandalone())) return
  synced = true
  try { await enablePush() } catch { synced = false }
}
