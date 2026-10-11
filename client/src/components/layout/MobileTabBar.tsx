'use client'

/* ─────────────────────────────────────────────────────────────
   Bottom tab bar — phones and tablets (below `lg`), every student page.
   A floating pill like a native app's: Home, Schedule, My Learning,
   Bookings, and More (the existing drawer, which holds everything else).
   Sits above the iPhone home indicator (safe-area inset); the dashboard
   layout reserves the same height at the bottom of the page.
───────────────────────────────────────────────────────────── */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { Home, CalendarDays, GraduationCap, Ticket, Menu } from 'lucide-react'
import { useUIStore } from '@/store/ui.store'

const TABS = [
  { label: 'Home',        href: '/',               icon: Home },
  { label: 'Schedule',    href: '/class-bookings', icon: CalendarDays },
  { label: 'Learning',    href: '/my-learning',    icon: GraduationCap },
  { label: 'Bookings',    href: '/my-bookings',    icon: Ticket },
] as const

export function MobileTabBar() {
  const path = usePathname() ?? '/'
  const reduce = useReducedMotion()
  const { mobileNavOpen, setMobileNav } = useUIStore()
  const isActive = (href: string) => href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)
  const anyTab = TABS.some(t => isActive(t.href))

  const cell = (active: boolean, children: React.ReactNode) => (
    <span className="relative flex h-full w-full flex-col items-center justify-center gap-0.5">
      {active && (
        <motion.span layoutId={reduce ? undefined : 'tabbar-pill'} className="absolute inset-x-1 inset-y-1 rounded-[22px]"
          style={{ background: 'var(--color-primary-light)' }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
      )}
      {children}
    </span>
  )

  return (
    <nav aria-label="Main"
      className="fixed inset-x-0 z-40 flex justify-center px-3 lg:hidden"
      style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
      <div className="dm flex h-[64px] w-full max-w-[460px] items-stretch rounded-[30px] px-1.5"
        style={{
          background: 'color-mix(in srgb, var(--color-bg-surface) 92%, transparent)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--color-border)', boxShadow: '0 10px 30px rgba(15,23,42,0.14)',
        }}>
        {TABS.map(({ label, href, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className="flex-1 outline-none">
              {cell(active, <>
                <Icon size={21} strokeWidth={active ? 2.4 : 2} className="relative" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }} />
                <span className="relative text-[11px] font-semibold" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{label}</span>
              </>)}
            </Link>
          )
        })}
        <button type="button" onClick={() => setMobileNav(true)} aria-label="More" aria-expanded={mobileNavOpen} className="flex-1 outline-none">
          {cell(!anyTab && mobileNavOpen, <>
            <Menu size={21} strokeWidth={2} className="relative" style={{ color: 'var(--color-text-secondary)' }} />
            <span className="relative text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>More</span>
          </>)}
        </button>
      </div>
    </nav>
  )
}
