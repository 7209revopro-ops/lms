'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, BookOpen, Users, GraduationCap,
  Tag, Star, Settings, ChevronLeft, ChevronRight, LogOut, X,
  ShoppingBag, Ticket, Map, ClipboardList, Video, CalendarDays, BarChart3, ShieldCheck, UserCog, LifeBuoy,
  ClipboardCheck, Film, MonitorSmartphone, FileCheck2, Megaphone,
} from 'lucide-react'
import { useUIStore } from '@/store/ui.store'
import { mayReachClassroom } from '@/lib/classroomAccess'
import { useAllLiveClasses } from '@/lib/api/liveClasses'
import { useCurrentUser, logout } from '@/lib/api/user'
import { useEnrollmentRequests } from '@/lib/api/enrollmentRequests'
import { useUnreadSupportCount } from '@/lib/api/support'
import { useRouter } from 'next/navigation'

/* ── All nav items (admin sees all) ──────────────────── */
const adminNavItems = [
  { label: 'Dashboard',      href: '/',                       icon: LayoutDashboard },
  { label: 'Users',      href: '/users',                  icon: UserCog },
  { label: 'Requests',   href: '/enrollment-requests',    icon: ClipboardCheck },
  { label: 'Courses',        href: '/courses',                icon: BookOpen },
  { label: 'Learning Paths', href: '/learning-paths',   icon: Map },
  { label: 'Live Classes',   href: '/live-classes',     icon: Video },
  { label: 'Recordings',     href: '/recordings',        icon: Film },
  { label: 'Bookings',       href: '/bookings',          icon: CalendarDays },
  { label: 'Assignments',    href: '/assignments',       icon: ClipboardCheck },
  { label: 'Exams',          href: '/exams',             icon: FileCheck2 },
  { label: 'Students',       href: '/students',          icon: Users },
  { label: 'Devices',        href: '/devices',           icon: MonitorSmartphone },
  { label: 'Instructors',    href: '/instructors',       icon: GraduationCap },
  { label: 'Categories',     href: '/categories',        icon: Tag },
  { label: 'Reviews',        href: '/reviews',           icon: Star },
  { label: 'Orders',         href: '/orders',            icon: ShoppingBag },
  /* super_admin + admin only, enforced server-side (requireAdmin) — not
     offered to sub_admin/support/instructor in their own nav arrays below. */
  { label: 'Announcements',  href: '/announcements',     icon: Megaphone },
  { label: 'Coupons',        href: '/coupons',           icon: Ticket },
  { label: 'Reports',        href: '/reports',           icon: BarChart3 },
  { label: 'Support',        href: '/support',           icon: LifeBuoy },
  { label: 'Audit Logs',     href: '/audit-logs',        icon: ClipboardList },
]

/* ── Scoped-admin nav (sub_admin, scoped by `program`) ─ */
const scopedAdminNavItems = [
  { label: 'Dashboard',        href: '/',                       icon: LayoutDashboard },
  { label: 'Requests',   href: '/enrollment-requests',    icon: ClipboardCheck },
  { label: 'Users',      href: '/users',                  icon: UserCog },
  /* Instructors are created from the Instructors page, and a sub-admin's
     only creatable role IS instructor — so the page has to be reachable
     from here, not only from the link the Users page offers. */
  { label: 'Instructors', href: '/instructors',          icon: GraduationCap },
  { label: 'Devices',    href: '/devices',                icon: MonitorSmartphone },
  { label: 'Courses',          href: '/courses',                icon: BookOpen },
  { label: 'Live Classes',     href: '/live-classes',           icon: Video },
  { label: 'Recordings',       href: '/recordings',             icon: Film },
  { label: 'Bookings',         href: '/bookings',               icon: CalendarDays },
  { label: 'Assignments',      href: '/assignments',            icon: ClipboardCheck },
  { label: 'Exams',            href: '/exams',                  icon: FileCheck2 },
  { label: 'Support',          href: '/support',                icon: LifeBuoy },
]

/* ── Instructor-restricted nav (view users + own content) ─ */
const instructorNavItems = [
  { label: 'My Courses',    href: '/courses',            icon: BookOpen },
  { label: 'Live Classes',  href: '/live-classes',       icon: Video },
  { label: 'Bookings',      href: '/bookings',           icon: CalendarDays },
  { label: 'Availability',  href: '/availability',       icon: CalendarDays },
  { label: 'Assignments',   href: '/assignments',        icon: ClipboardCheck },
  { label: 'Exams',         href: '/exams',              icon: FileCheck2 },
  { label: 'Students',      href: '/students',            icon: Users },
  { label: 'Instructors',   href: '/instructors',        icon: GraduationCap },
  { label: 'Reviews',       href: '/reviews',             icon: Star },
]

/* Settings is platform configuration, and the page's own device-limit query
   goes to GET /admin/settings/device-limit behind `requireAnyAdmin`
   (backend/src/middleware/auth.middleware.ts:411) -- a list that does NOT
   include `instructor`. The link was in the footer for every role, so an
   instructor who tapped it got a page of bcrypt/JWT/rate-limit rows with a
   403 in the middle of it. */
const settingsItem = { label: 'Settings', href: '/settings', icon: Settings }

interface SidebarContentProps {
  collapsed: boolean
  onClose?:  () => void
}

function SidebarContent({ collapsed, onClose }: SidebarContentProps) {
  const pathname      = usePathname()
  const router        = useRouter()
  const { data: user } = useCurrentUser()
  const { data: allLive } = useAllLiveClasses('live')
  const liveNowCount = allLive?.length ?? 0

  const isInstructor  = user?.role === 'instructor'
  const isManager     = user?.role === 'sub_admin'
  const canSeeRequests = !isInstructor

  const { data: pendingData } = useEnrollmentRequests('pending', undefined)
  const pendingCount = canSeeRequests ? (pendingData?.meta?.total_count ?? 0) : 0
  const { data: unreadSupport = 0 } = useUnreadSupportCount()
  const baseNavItems = isInstructor ? instructorNavItems : isManager ? scopedAdminNavItems : adminNavItems
  /* Support sits in the admin nav but may not reach a classroom, live or
     recorded. Offering the link anyway would just hand them a 403. */
  const withClassroom = mayReachClassroom(user?.role)
    ? baseNavItems
    : baseNavItems.filter(i => i.href !== '/recordings')
  // Role/permission management is platform-wide (spans every organization) —
  // only super_admin manages it, so the link is hidden for org-scoped admins.
  const navItems  = user?.role === 'super_admin'
    ? [...withClassroom, { label: 'Roles', href: '/roles', icon: ShieldCheck }]
    : withClassroom
  const roleLabel = isInstructor ? 'Instructor' : isManager ? 'Manager' : 'Admin'
  const bottomItems = isInstructor ? [] : [settingsItem]

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  const handleLogout = async () => {
    await logout()
    router.replace('/login')
  }

  /* First letter of display name for avatar */
  const initial = (user?.name ?? 'A').charAt(0).toUpperCase()

  return (
    <>
      {/* ── Logo ─────────────────────────────────── */}
      <div
        className="flex h-[60px] flex-shrink-0 items-center px-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}
              className="flex items-center gap-2 overflow-hidden min-w-0">
              <img src="/logo.png" alt="Delta" style={{ height: 32, width: 'auto', maxWidth: 130, objectFit: 'contain', flexShrink: 0 }} />
              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
                style={{ background: 'rgba(0,87,184,0.18)', color: '#0057b8' }}>{roleLabel}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile close — only in drawer */}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Nav items ───────────────────────────── */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 py-4">
        {!collapsed && (
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.15em]"
            style={{ color: 'rgba(255,255,255,0.2)' }}>Menu</p>
        )}

        {navItems.map(item => {
          const active = isActive(item.href)
          const Icon   = item.icon
          return (
            <Link key={item.href} href={item.href} onClick={onClose}>
              <motion.div
                whileHover={{ x: collapsed ? 0 : 3 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className="relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
                style={{
                  background: active ? 'rgba(0,87,184,0.12)' : 'transparent',
                  color: active ? '#0057b8' : 'rgba(255,255,255,0.5)',
                }}
                title={collapsed ? item.label : undefined}
              >
                {active && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-xl"
                    style={{ background: 'rgba(0,87,184,0.10)', border: '1px solid rgba(0,87,184,0.20)' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon size={17} className="relative z-10 flex-shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.13 }}
                      className="relative z-10 flex flex-1 items-center justify-between whitespace-nowrap text-sm font-medium">
                      {item.label}
                      {/* Pending requests badge */}
                      {item.href === '/enrollment-requests' && pendingCount > 0 && (
                        <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                          style={{ background: '#F59E0B' }}>
                          {pendingCount}
                        </span>
                      )}
                      {/* Unread support messages badge */}
                      {item.href === '/support' && unreadSupport > 0 && (
                        <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                          style={{ background: '#EF4444' }}>
                          {unreadSupport > 99 ? '99+' : unreadSupport}
                        </span>
                      )}
                      {/* Pulsing live badge — only on Live Classes item when streams are active */}
                      {item.href === '/live-classes' && liveNowCount > 0 && (
                        <motion.span
                          animate={{ opacity: [1, 0.4, 1] }}
                          transition={{ duration: 1.4, repeat: Infinity }}
                          className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                          style={{ background: '#EF4444' }}>
                          {liveNowCount}
                        </motion.span>
                      )}
                    </motion.span>
                  )}
                </AnimatePresence>
                {/* Collapsed state: small dot indicators */}
                {collapsed && item.href === '/live-classes' && liveNowCount > 0 && (
                  <motion.span
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                    className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
                    style={{ background: '#EF4444' }}
                  />
                )}
                {collapsed && item.href === '/support' && unreadSupport > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
                    style={{ background: '#EF4444' }} />
                )}
              </motion.div>
            </Link>
          )
        })}
      </nav>

      {/* ── Bottom ──────────────────────────────── */}
      <div className="flex-shrink-0 px-2 pb-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
        {bottomItems.map(item => {
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href} onClick={onClose}>
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.4)' }} title={collapsed ? item.label : undefined}>
                <Icon size={17} strokeWidth={1.8} className="flex-shrink-0" />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="whitespace-nowrap text-sm font-medium">{item.label}</motion.span>
                  )}
                </AnimatePresence>
              </div>
            </Link>
          )
        })}

        {/* User row */}
        <div className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>{initial}</div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">{user?.name ?? '—'}</p>
                <p className="truncate text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {user?.email ?? ''}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={handleLogout}
            className="flex-shrink-0 transition-opacity hover:opacity-70 hover:text-red-400"
            style={{ color: 'rgba(255,255,255,0.3)' }}
            title="Sign out">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </>
  )
}

export function AdminSidebar() {
  const { sidebarCollapsed, mobileNavOpen, setMobileNav, toggleSidebar } = useUIStore()
  const w = sidebarCollapsed ? 68 : 240

  /* While the drawer is open it is the only thing you can interact with, so
     the page behind it should not scroll under your thumb, and Escape should
     close it the way it closes every other overlay in here. */
  useEffect(() => {
    if (!mobileNavOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNav(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [mobileNavOpen, setMobileNav])

  return (
    <>
      {/* ── Desktop sidebar: hidden below lg ──────────── */}
      <motion.aside
        animate={{ width: w }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed left-0 top-0 z-40 hidden h-dvh flex-col overflow-hidden lg:flex"
        style={{ background: '#0D0F1A', borderRight: '1px solid rgba(255,255,255,0.06)' }}
      >
        <SidebarContent collapsed={sidebarCollapsed} />
      </motion.aside>

      {/* ── Floating collapse/expand toggle ───────────── */}
      <motion.button
        initial={{ left: w - 14 }}
        animate={{ left: w - 14 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={toggleSidebar}
        className="fixed top-[22px] z-50 hidden h-8 w-8 items-center justify-center rounded-full border lg:flex"
        style={{
          background: '#1a1f36',
          borderColor: 'rgba(255,255,255,0.25)',
          color: 'rgba(255,255,255,0.8)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
        }}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        whileHover={{ scale: 1.1, borderColor: 'rgba(0,87,184,0.6)', color: '#0057b8' }}
        whileTap={{ scale: 0.92 }}
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </motion.button>

      {/* ── Mobile drawer + backdrop: only shown below lg ─ */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="admin-mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/70 lg:hidden"
              onClick={() => setMobileNav(false)}
            />
            {/* Drawer */}
            <motion.aside
              key="admin-mobile-drawer"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              /* h-dvh, not h-screen. 100vh on iOS Safari and Chrome Android
                 is the toolbar-retracted height, ~90-115px taller than what
                 you can actually see on load. This panel is
                 `flex + overflow-hidden` with only the <nav> scrolling, so
                 that surplus pushed the whole ~128px footer -- Settings, the
                 user row, and its Sign out button -- below the fold with
                 nothing to scroll it back. Sign out had no other route on a
                 phone either: the topbar avatar was off-screen too. */
              className="fixed left-0 top-0 z-50 flex h-dvh w-[280px] flex-col overflow-hidden lg:hidden"
              style={{ background: '#0D0F1A' }}
              role="dialog"
              aria-modal="true"
              aria-label="Main navigation"
            >
              <SidebarContent collapsed={false} onClose={() => setMobileNav(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
