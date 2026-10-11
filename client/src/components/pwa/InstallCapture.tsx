'use client'
/* Catches the browser's install offer for the "Install app" row in the More
   drawer — no popup of its own (lib/pwaInstall.ts). */
import { useEffect } from 'react'
import { captureInstallPrompt } from '@/lib/pwaInstall'

export function InstallCapture() {
  useEffect(() => captureInstallPrompt(), [])
  return null
}
