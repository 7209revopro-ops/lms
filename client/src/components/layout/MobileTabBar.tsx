'use client'

/* ─────────────────────────────────────────────────────────────
   Bottom tab bar — phones and tablets (below `lg`), every student page.
   A floating pill like a native app's:
     Home (My Learning) · Schedule (badge: new classes) · Support ·
     Notifications (badge: unread; opens the drawer) · More (the menu).
   Sits above the iPhone home indicator (safe-area inset); the dashboard
   layout reserves the same height at the bottom of the page.
───────────────────────────────────────────────────────────── */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { Home, CalendarDays, LifeBuoy, Bell, Menu } from 'lucide-react'
import { useUIStore } from '@/store/ui.store'
import { useSheets } from '@/store/sheets.store'
import { useUnreadCount, useNewClassesCount } from '@/lib/api/notifications'

const LINKS = [
  { label: 'Schedule', href: '/class-bookings', icon: CalendarDays },
  { label: 'Home',     href: '/my-learning',    icon: Home },
  { label: 'Support',  href: '/support',        icon: LifeBuoy },
] as const

function Badge({ n, tone }: { n: number; tone: string }) {
  if (!n) return null
  return (
    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 420 }}
      className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
      style={{ background: tone, boxShadow: '0 0 0 2px var(--color-bg-surface)' }}>
      {n > 99 ? '99+' : n}
    </motion.span>
  )
}

export function MobileTabBar() {
  const path = usePathname() ?? '/'
  const reduce = useReducedMotion()
  const { mobileNavOpen, setMobileNav } = useUIStore()
  const { notificationsOpen, setNotificationsOpen } = useSheets()
  const { data: unread = 0 } = useUnreadCount()
  const { data: newClasses = 0 } = useNewClassesCount()
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`)

  const tab = (active: boolean, Icon: React.ElementType, label: string, badge?: React.ReactNode) => (
    <span className="relative flex h-full w-full flex-col items-center justify-center gap-0.5">
      {active && (
        <motion.span layoutId={reduce ? undefined : 'tabbar-pill'} className="absolute inset-x-0.5 inset-y-1 rounded-[22px]"
          style={{ background: 'var(--color-primary-light)' }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
      )}
      <span className="relative">
        <Icon size={21} strokeWidth={active ? 2.4 : 2} style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }} />
        {badge}
      </span>
      <span className="relative text-[10.5px] font-semibold" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{label}</span>
    </span>
  )

  return (
    <nav aria-label="Main" className="fixed inset-x-0 z-40 flex justify-center px-3 lg:hidden"
      style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
      <div className="dm flex h-[64px] w-full max-w-[480px] items-stretch rounded-[30px] px-1"
        style={{
          background: 'color-mix(in srgb, var(--color-bg-surface) 92%, transparent)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--color-border)', boxShadow: '0 10px 30px rgba(15,23,42,0.14)',
        }}>
        {LINKS.map(({ label, href, icon }) => {
          const active = isActive(href) && !notificationsOpen && !mobileNavOpen
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className="flex-1 outline-none"
              aria-label={href === '/class-bookings' && newClasses ? `Schedule, ${newClasses} new classes` : label}>
              {tab(active, icon, label, href === '/class-bookings' ? <Badge n={newClasses} tone="#D97706" /> : undefined)}
            </Link>
          )
        })}
        <button type="button" onClick={() => setNotificationsOpen(true)} className="flex-1 outline-none"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          {tab(notificationsOpen, Bell, 'Notifications', <Badge n={unread} tone="var(--color-danger)" />)}
        </button>
        <button type="button" onClick={() => setMobileNav(true)} aria-label="More" aria-expanded={mobileNavOpen} className="flex-1 outline-none">
          {tab(mobileNavOpen, Menu, 'More')}
        </button>
      </div>
    </nav>
  )
}
