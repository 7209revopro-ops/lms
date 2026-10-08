'use client'

/* ─────────────────────────────────────────────────────────────
   /s/<code> — the button in a student's "new class scheduled" and "today's
   classes" WhatsApp messages. Redeems the code (POST /auth/signin-link/redeem),
   which signs them in when this browser has no session — no password — and
   answers the page the code was made for; then goes there.
   Public in middleware.ts — the whole point is arriving signed out.
───────────────────────────────────────────────────────────── */
import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { api } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'

export default function SigninLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)   // the code signs in once — guard StrictMode's double effect

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void (async () => {
      try {
        const res = await api.post<{ data: { next: string } }>('/auth/signin-link/redeem', { token })
        const next = res.data.data.next
        /* Full navigation, so the new session cookie is used everywhere. */
        window.location.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/my-bookings')
      } catch (err) {
        const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        setError(msg ?? 'This link is invalid or has expired.')
      }
    })()
  }, [token])

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10" style={{ background: 'var(--color-bg-page)' }}>
      <div className="w-full max-w-[420px] rounded-3xl bg-[var(--color-bg-surface)] p-8 text-center"
        style={{ border: '1px solid var(--color-border)', boxShadow: '0 24px 80px rgba(13,15,26,0.08)' }}>
        {!error ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Spinner size={24} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Signing you in…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <AlertCircle size={26} style={{ color: 'var(--color-danger)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Link problem</p>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{error}</p>
            <Link href={`/login?method=email&from=${encodeURIComponent('/my-bookings')}`}
              className="mt-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ background: 'var(--color-primary)' }}>
              Sign in with an email code
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
