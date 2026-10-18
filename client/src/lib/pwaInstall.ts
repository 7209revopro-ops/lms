'use client'
/* ─────────────────────────────────────────────────────────────
   "Install app". The browser's install offer (beforeinstallprompt) is caught
   once for the whole app and kept here; the More drawer's "Install app" row
   and the install popup (components/pwa/InstallPopup.tsx, since 2026-10-18)
   call promptInstall() while one is available. iPhones never fire the event —
   both explain Share → Add to Home Screen instead.
───────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as { standalone?: boolean }).standalone === true
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** Call once (PwaRegister in the root layout). */
export function captureInstallPrompt(): () => void {
  const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; notify() }
  const onInstalled = () => { deferred = null; notify() }
  window.addEventListener('beforeinstallprompt', onPrompt)
  window.addEventListener('appinstalled', onInstalled)
  return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled) }
}

/** 'prompt' — the browser can install it now; 'ios' — show the Share hint; null — nothing to offer. */
export function useInstallOffer(): 'prompt' | 'ios' | null {
  const [, tick] = useState(0)
  useEffect(() => { const l = () => tick(n => n + 1); listeners.add(l); return () => { listeners.delete(l) } }, [])
  if (typeof window === 'undefined' || isStandalone()) return null
  if (deferred) return 'prompt'
  return isIOS() ? 'ios' : null
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return
  await deferred.prompt()
  await deferred.userChoice.catch(() => undefined)
  deferred = null
  notify()
}
