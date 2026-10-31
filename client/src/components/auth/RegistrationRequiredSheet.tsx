'use client'
/* The one prompt for every action a paid /explore buyer cannot take until the
   registration form is in — booking, joining a class, opening a lesson
   (lib/registrationGate.ts). Mounted once in the dashboard layout. */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight, CalendarCheck, ClipboardList, PlayCircle, Video } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { onRegistrationRequired, type GatedAction } from '@/lib/registrationGate'

const TITLE: Record<GatedAction, string> = {
  book:   'Complete your registration to book classes',
  join:   'Complete your registration to join classes',
  lesson: 'Complete your registration to open lessons',
  other:  'Complete your registration to continue',
}

export function RegistrationRequiredSheet() {
  const [action, setAction] = useState<GatedAction | null>(null)
  const pathname = usePathname()
  useEffect(() => onRegistrationRequired(setAction), [])
  /* A navigation closes it — the student went somewhere, possibly the form. */
  useEffect(() => { setAction(null) }, [pathname])
  /* Keyboard and screen-reader users land on the way on; focus goes back where it was on close. */
  const primary = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (!action) return
    const before = document.activeElement as HTMLElement | null
    const t = setTimeout(() => primary.current?.focus(), 50)
    return () => { clearTimeout(t); before?.focus?.() }
  }, [action])
  if (!action) return null

  const unlock = (icon: React.ReactNode, text: string) => (
    <li className="flex items-center gap-2.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(0,87,184,0.08)', color: 'var(--color-primary)' }}>{icon}</span>
      {text}
    </li>
  )

  return (
    <BottomSheet onClose={() => setAction(null)} label={TITLE[action]}>
      <div className="px-6 pb-6 pt-6 sm:pt-7">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(217,119,6,0.12)', color: '#B45309' }}>
          <ClipboardList size={22} />
        </div>
        <h2 className="pr-8 text-lg font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{TITLE[action]}</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          Your payment is confirmed and your course is in your account. One step is left: your registration form. Your name, email and phone are already filled in — it takes a few minutes.
        </p>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Submitting it unlocks</p>
        <ul className="mt-2 space-y-2">
          {unlock(<CalendarCheck size={14} />, 'Booking your live classes')}
          {unlock(<Video size={14} />, 'Joining classes')}
          {unlock(<PlayCircle size={14} />, 'Your course lessons')}
        </ul>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setAction(null)}
            className="min-h-[44px] rounded-xl px-4 text-sm font-semibold transition-colors hover:bg-[var(--color-bg-muted)]"
            style={{ color: 'var(--color-text-secondary)' }}>
            Not now
          </button>
          <Link ref={primary} href="/complete-registration" onClick={() => setAction(null)}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-primary)' }}>
            Complete registration
            <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </BottomSheet>
  )
}
