'use client'
/* ─────────────────────────────────────────────────────────────
   Desktop / phone alerts for new chat messages (2026-10-18).

   The browser's own notification, shown only while this app is open but NOT
   being looked at (another tab, minimised, the installed app in the
   background) — when it is in front, the in-app toast and bell already say
   it. Asking for permission takes a click (the bell's "Turn on desktop
   alerts"); browsers ignore or punish an unprompted ask.

   Shown through the service worker when there is one, because Android
   Chrome refuses `new Notification()`; app-sw.js opens the chat on a tap.
───────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useState } from 'react'

const supported = () => typeof window !== 'undefined' && 'Notification' in window

export function useDesktopAlerts() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('unsupported')
  useEffect(() => { if (supported()) setPerm(Notification.permission) }, [])
  const ask = useCallback(async () => {
    if (!supported()) return
    try { setPerm(await Notification.requestPermission()) } catch { /* old Safari: callback form only */ }
  }, [])
  return { canAsk: perm === 'default', on: perm === 'granted', ask }
}

export async function showDesktopAlert(title: string, body: string, url: string): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  const opts: NotificationOptions = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: url, data: { url } }
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    /* This device gets push (lib/push.ts): the LMS already sends this one — showing it here too would be twice. */
    if (reg && 'pushManager' in reg && await reg.pushManager.getSubscription().catch(() => null)) return
    if (reg) { await reg.showNotification(title, opts); return }
    const n = new Notification(title, opts)
    n.onclick = () => { window.focus(); window.location.assign(url); n.close() }
  } catch { /* alerts are a nicety — never break the page over one */ }
}
