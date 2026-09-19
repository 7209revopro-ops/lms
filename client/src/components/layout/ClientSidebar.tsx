'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen, GraduationCap, Trophy,
  Settings, LogOut, Flame, Map, X, Video, CalendarDays, LifeBuoy, ClipboardList,
  Ticket, Receipt,
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
  { label: 'Orders',         href: '/orders',          icon: Receipt },
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
          aria-label="Close menu"
          className="-mr-2.5 ml-auto flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)]"
          style={{ color: 'var(--color-primary)' }}>
          <X size={18} />
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
            /* The hit area was the 14px glyph and nothing else - a fifth of
               the 44px minimum, for the one control that ends your session,
               12px from a link to Settings. -mr-2 keeps the row's optical
               alignment while the target grows to 44. */
            className="-mr-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-all hover:bg-[var(--color-hover-danger)] hover:text-red-500" style={{ color: 'var(--color-text-muted)' }}>
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  )
}

export function ClientSidebar() {
  const { mobileNavOpen, setMobileNav } = useUIStore()

  /* A DRAWER THAT IS OPEN IS A MODAL, AND THIS ONE DID NOT BEHAVE LIKE ONE.
     Escape did nothing, and nothing locked the page behind it - so a thumb
     landing on the 95px of dimmed strip beside the panel scrolled the page
     underneath instead of dismissing anything, which on a phone is most of
     what a thumb lands on. Closing then returned you somewhere else.

     The scroll position is captured and restored rather than simply unset:
     `overflow: hidden` on body drops iOS back to the top, so without this the
     drawer would still lose your place, just more quietly. */
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNav(false) }
    window.addEventListener('keydown', onKey)

    const y = window.scrollY
    const { overflow, position, top, width } = document.body.style
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top      = `-${y}px`
    document.body.style.width    = '100%'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      document.body.style.position = position
      document.body.style.top      = top
      document.body.style.width    = width
      window.scrollTo(0, y)
    }
  }, [mobileNavOpen, setMobileNav])

  return (
    /* TWO KEYED CHILDREN, NOT ONE FRAGMENT.

       AnimatePresence tracks its own DIRECT children by key. A fragment is a
       single child and carries no key, so the backdrop and the drawer inside
       it were invisible to it and their exit animations did not run: the
       drawer vanished rather than sliding out. The keys were already on the
       motion elements - they were one level too deep to count.

       (An earlier version of this comment claimed the fragment also left the
       backdrop mounted for ever, blocking the page. That was wrong. It was an
       artifact of measuring in a hidden browser pane, where rAF never ticks,
       so no exit animation can ever complete and AnimatePresence rightly
       keeps waiting. Nothing here was broken for a real user.) */
    <AnimatePresence>
      {mobileNavOpen && (
          <motion.div
            key="client-mobile-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileNav(false)}
          />
      )}
      {mobileNavOpen && (
          <motion.aside
            key="client-mobile-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            /* 100dvh, NOT h-screen. On iOS Safari 100vh is the LARGE viewport -
               the height the page would have if the toolbars were retracted -
               so an h-screen drawer runs about 85px below the glass. This one
               is overflow-hidden with a flex-shrink-0 footer, so that 85px was
               the Settings row, the account card and Sign out, with nothing
               able to scroll them into view. The only navigation below 1024px
               and you could not sign out of it. dvh is the visible viewport. */
            role="dialog"
            aria-modal="true"
            aria-label="Main menu"
            className="fixed left-0 top-0 z-50 flex h-[100dvh] w-[min(280px,85vw)] flex-col overflow-hidden bg-[var(--color-bg-surface)]"
            style={{ borderRight: '1px solid var(--color-border)' }}>
            <SidebarContent onClose={() => setMobileNav(false)} />
          </motion.aside>
      )}
    </AnimatePresence>
  )
}
