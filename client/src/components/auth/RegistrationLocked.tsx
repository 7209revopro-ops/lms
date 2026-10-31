'use client'
/* In place of a lesson or a class player while the registration form is still
   due (lib/registrationGate.ts) — says why, and the one way on. */
import Link from 'next/link'
import { ArrowRight, Lock } from 'lucide-react'
import type { GatedAction } from '@/lib/registrationGate'

const COPY: Partial<Record<GatedAction, { title: string; body: string }>> = {
  lesson: { title: 'This lesson unlocks after registration',
    body: 'Your course is in your account. Complete your registration form to open its lessons — your name, email and phone are already filled in.' },
  join:   { title: 'This class unlocks after registration',
    body: 'Complete your registration form to join and watch your classes — your name, email and phone are already filled in.' },
}

export function RegistrationLocked({ action = 'lesson', backHref, backLabel }: { action?: GatedAction; backHref?: string; backLabel?: string }) {
  const c = COPY[action] ?? COPY.lesson!
  return (
    <div className="mx-auto my-6 max-w-lg rounded-3xl border p-7 text-center sm:p-9" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}>
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'rgba(217,119,6,0.12)', color: '#B45309' }}>
        <Lock size={24} />
      </div>
      <h2 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{c.title}</h2>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{c.body}</p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <Link href="/complete-registration"
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-primary)' }}>
          Complete registration
          <ArrowRight size={15} />
        </Link>
        {backHref && (
          <Link href={backHref} className="text-sm font-semibold hover:underline" style={{ color: 'var(--color-text-muted)' }}>{backLabel ?? 'Back'}</Link>
        )}
      </div>
    </div>
  )
}
