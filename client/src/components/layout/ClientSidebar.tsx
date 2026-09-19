'use client'

import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen, GraduationCap, Trophy,
  Settings, LogOut, Flame, Map, X, Video, CalendarDays, LifeBuoy, ClipboardList,
  Ticket,
} from 'lucide-react'
import { useUIStore } from '@/store/ui.store'
import { logout as apiLogout, useCurrentUser } from '@/lib/api/user'
import { AvatarImg } from '@/components/ui/AvatarImg'

const navItems = [
  { label: 'My Learning',    href: '/my-learning',    icon: GraduationCap },
  { label: 'Class Schedule', href: '/class-bookings', icon: CalendarDays },
  { label: 'My Bookings',    href: '/my-bookings',    icon: Ticket },
  { label: 'Assignments',    href: '/assignments',     icon: ClipboardList },
  { label: 'Catalog',        href: '/courses',         icon: BookOpen },
  { label: 'Learning Paths', href: '/learning-paths',  icon: Map },
  { label: 'Achievements',   href: '/achievements',    icon: Trophy },
  { label: 'Streaks',        href: '/streaks',         icon: Flame },
  { label: 'Help & Support', href: '/support',         icon: LifeBuoy },
]
const bottomItems = [{ label: 'Settings', href: '/settings', icon: Settings }]

const itemVariants = {
  hidden: { opacity: 0, x: -14 },
  show:   (i: number) => ({
    opacity: 1, x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 26, delay: 0.06 + i * 0.04 },
  }),
}

function SidebarContent({ onClose }: { onClose: () => void }) {
  const pathname = usePathname()
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  /* The signed-in account. This row used to be hardcoded design placeholder
     text ("Adit Irwan / student@learnos.com") — it shipped that way, so every
     student on mobile was shown a stranger's name and email next to a logout
     button. Same source and same shape as ClientTopbar, which was doing it
     correctly all along. */
  const { data: user } = useCurrentUser()
  const displayName    = user?.name ?? 'Account'
  const displayEmail   = user?.email ?? ''
  const avatarInitial  = (user?.name?.trim()?.[0] ?? '?').toUpperCase()
  const hasAvatarImage = !!user?.avatarUrl

  const handleLogout = async () => {
    await apiLogout()
    localStorage.removeItem('lms-cart')
    window.location.href = '/login'
  }

  return (
    <>
      {/* ── Logo ─────────────────────────────── */}
      <div className="flex h-[60px] flex-shrink-0 items-center gap-3 px-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <img
          src="/logo-dark.png"
          alt="Delta International"
          className="h-8 w-auto object-contain"
        />
        <button onClick={onClose}
          className="ml-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)]"
          style={{ color: 'var(--color-primary)' }}>
          <X size={15} />
        </button>
      </div>

      {/* ── Nav ──────────────────────────────── */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-4">
        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.15em]"
          style={{ color: 'var(--color-text-muted)' }}>Menu</p>

        {navItems.map((item, i) => {
          const active = isActive(item.href)
          const Icon   = item.icon
          return (
            <motion.div key={item.href} custom={i} variants={itemVariants} initial="hidden" animate="show">
              <Link href={item.href} onClick={onClose}>
                <motion.div whileTap={{ scale: 0.97 }}
                  className="relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
                  style={{ background: active ? 'rgba(0,87,184,0.08)' : 'transparent', color: active ? '#0057b8' : 'var(--color-text-secondary)' }}>
                  {active && (
                    <motion.div layoutId="mobile-sidebar-active" className="absolute inset-0 rounded-xl"
                      style={{ background: 'rgba(0,87,184,0.08)', border: '1px solid rgba(0,87,184,0.18)' }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                  )}
                  <Icon size={17} className="relative z-10 flex-shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                  <span className="relative z-10 whitespace-nowrap text-sm font-medium">{item.label}</span>
                </motion.div>
              </Link>
            </motion.div>
          )
        })}
      </nav>

      {/* ── Bottom ────────────────────────────── */}
      <div className="flex-shrink-0 px-2 pb-4" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
        {bottomItems.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href} onClick={onClose}>
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--color-hover)]"
                style={{ color: 'var(--color-text-muted)' }}>
                <Icon size={17} strokeWidth={1.8} className="flex-shrink-0" />
                <span className="whitespace-nowrap text-sm font-medium">{item.label}</span>
              </div>
            </Link>
          )
        })}

        {/* User row */}
        <div className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5"
          style={{ background: 'var(--color-bg-page)', border: '1px solid var(--color-border)' }}>
          <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full">
            <AvatarImg src={user?.avatarUrl}
              className="h-full w-full object-cover"
              fallback={<div className="flex h-full w-full items-center justify-center text-xs font-bold text-white"
                  style={{ background: 'var(--color-primary)' }}>{avatarInitial}</div>} />
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white"
              style={{ background: 'var(--color-success)' }} />
          </div>
          {/* Tapping your own name should take you to your account, not sit
              inert next to a bare sign-out icon. */}
          <Link href="/settings" onClick={onClose} className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{displayName}</p>
            <p className="truncate text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{displayEmail}</p>
          </Link>
          {/* An unlabelled icon beside your own name reads as "profile", which
              is why signing out felt like a bug rather than a button. */}
          <button
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            className="flex-shrink-0 transition-all hover:text-red-500" style={{ color: 'var(--color-text-muted)' }}>
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </>
  )
}

export function ClientSidebar() {
  const { mobileNavOpen, setMobileNav } = useUIStore()

  return (
    <AnimatePresence>
      {mobileNavOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="client-mobile-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileNav(false)}
          />
          {/* Drawer */}
          <motion.aside
            key="client-mobile-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed left-0 top-0 z-50 flex h-screen w-[min(280px,85vw)] flex-col overflow-hidden bg-[var(--color-bg-surface)]"
            style={{ borderRight: '1px solid var(--color-border)' }}>
            <SidebarContent onClose={() => setMobileNav(false)} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
