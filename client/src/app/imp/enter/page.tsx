'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Spinner from '@/components/ui/Spinner'
import { api } from '@/lib/axios'

/* ─────────────────────────────────────────────────────
   Impersonation handoff — redemption

   Deliberately outside the (dashboard) group: it runs before any session
   exists, so it must not sit under a layout that expects one.

   The code arrives in the query string because a new tab is the only way the
   admin portal can hand anything to this origin. It is exchanged immediately
   for an httpOnly cookie and then left behind by a replace() — it is
   single-use and 60-second-lived regardless.
───────────────────────────────────────────────────── */

function Waiting({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3"
      style={{ background: 'var(--color-bg-page)' }}>
      <Spinner size={22} />
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
    </main>
  )
}

function Redeemer() {
  const params = useSearchParams()
  const router = useRouter()
  const code   = params.get('code')

  const [error, setError] = useState<string | null>(null)
  /* React StrictMode mounts effects twice in dev. The code is single-use, so
     the second run would always fail and report an error on a redemption that
     actually succeeded. */
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true

    if (!code) { setError('This link is missing its code.'); return }

    void (async () => {
      try {
        await api.post('/auth/impersonation/redeem', { code })
        /* Hard navigation, not router.replace(): the session changed identity,
           so every React Query cache entry belongs to the wrong account and
           must not survive. It also guarantees the middleware re-runs with the
           new cookie already in the jar. */
        window.location.replace('/class-bookings')
      } catch (err: any) {
        /* A spent code is the expected result of reloading this page after a
           successful redemption — the cookie is already set, so reporting
           "invalid link" would contradict the live banner above the message.
           The flag cookie answers that without a request. */
        if (document.cookie.split('; ').some(c => c === 'lms_imp=1')) {
          window.location.replace('/class-bookings')
          return
        }

        setError(
          err?.response?.data?.error?.message
          ?? 'This link has expired or has already been used.',
        )
      }
    })()
  }, [code, router])

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
        style={{ background: 'var(--color-bg-page)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          This link is no longer valid
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {error} Start a new session from the Students table in the admin panel.
        </p>
        <Link href="/login"
          className="mt-6 rounded-2xl px-5 py-2.5 text-sm font-bold text-white"
          style={{ background: 'var(--color-primary)' }}>
          Go to sign in
        </Link>
      </main>
    )
  }

  return <Waiting label="Opening the student portal…" />
}

/* useSearchParams() opts the tree into client-side rendering, which the
   production build refuses to prerender without a boundary. */
export default function ImpersonationEnterPage() {
  return (
    <Suspense fallback={<Waiting label="Loading…" />}>
      <Redeemer />
    </Suspense>
  )
}
