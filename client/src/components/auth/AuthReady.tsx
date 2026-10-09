'use client'

/* Marks the sign-in screens as running (html[data-auth-ready]) once React has
   started. Until then globals.css (.auth-shell) is allowed to reveal what the
   entrance animations hide — they render at opacity 0 on the server and only
   JavaScript fades them in. When the JavaScript never arrives (a half-done
   deployment answered 400 for its files on 9 Oct 2026) the page was a white
   screen with working inputs; now the form simply appears without the fade. */
import { useEffect } from 'react'

export function AuthReady() {
  useEffect(() => {
    document.documentElement.setAttribute('data-auth-ready', '')
  }, [])
  return null
}
