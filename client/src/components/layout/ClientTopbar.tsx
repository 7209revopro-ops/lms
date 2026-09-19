'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Search, Bell, X, MessageSquare, BookOpen,
  GraduationCap, Heart, Sparkles, Trophy,
  Settings, Clock, Star, Users, Video, Flame, Menu, ShoppingCart, Map, CalendarDays, LifeBuoy,
  Ticket, Receipt,
  ClipboardList, LogOut, Sun, Moon, Monitor,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import { useUIStore } from '@/store/ui.store'
import { useCurrentUser, logout as apiLogout } from '@/lib/api/user'
import { useThemeStore } from '@/store/theme.store'
import { useCartStore } from '@/store/cart.store'
import type { Course, PaginationMeta } from '@/types/index'
import {
  useNotifications, useUnreadCount, useMarkRead, useMarkAllRead,
  type Notification,
} from '@/lib/api/notifications'
import { AIChatPanel } from '@/components/layout/AIChatPanel'
import { useIsMobile } from '@/hooks/useIsMobile'
import { AvatarImg } from '@/components/ui/AvatarImg'

/* Nav tabs shown when sidebar layout is active (minimal — sidebar handles main nav) */
const SIDEBAR_TABS = [
  { label: 'My Learning', href: '/my-learning',    icon: GraduationCap },
  { label: 'Schedule',    href: '/class-bookings', icon: CalendarDays },
  { label: 'My Bookings', href: '/my-bookings',    icon: Ticket },
  { label: 'Assignments', href: '/assignments',     icon: ClipboardList },
  { label: 'Catalog',     href: '/courses',         icon: BookOpen },
  { label: 'Learning Paths', href: '/learning-paths', icon: Map },
  { label: 'Favorites',   href: '/favorites',       icon: Heart, badge: 1 },
  { label: 'Support',     href: '/support',         icon: LifeBuoy },
]

/* Nav tabs shown when topbar-only layout is active (full navigation) */
const TOPBAR_TABS = [
  { label: 'My Learning',    href: '/my-learning',    icon: GraduationCap },
  { label: 'Class Schedule', href: '/class-bookings', icon: CalendarDays },
  /* The seats you hold, next to the place you take them. This row is the ONLY
     navigation a desktop window gets - the hamburger that opens the drawer is
     `lg:hidden` - so a page missing from here is a page reachable only by
     typing its URL, which is what /my-bookings was. */
  { label: 'My Bookings',    href: '/my-bookings',     icon: Ticket },
  { label: 'Assignments',    href: '/assignments',     icon: ClipboardList },
  { label: 'Catalog',        href: '/courses',         icon: BookOpen },
  { label: 'Learning Paths', href: '/learning-paths',  icon: Map },
  { label: 'Achievements',   href: '/achievements',    icon: Trophy },
  { label: 'Streaks',        href: '/streaks',         icon: Flame },
  { label: 'Favorites',      href: '/favorites',       icon: Heart, badge: 1 },
  { label: 'Settings',       href: '/settings',        icon: Settings },
  { label: 'Help & Support', href: '/support',         icon: LifeBuoy },
]

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/* ── Live-search hook: debounce 280ms, min 2 chars ── */
function useTypeahead(q: string) {
  return useQuery({
    queryKey: ['typeahead', q],
    queryFn: async () => {
      const res = await api.get<{ success: true; data: Course[]; meta: PaginationMeta }>(
        '/courses',
        { params: { search: q, search_mode: 'prefix', per_page: 5 } },
      )
      return res.data.data
    },
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  })
}

/* ── Syncs the search input with ?q= on the /search page ──────
   Must live in its own component so useSearchParams() is
   isolated inside a Suspense boundary (Next.js 15 requirement).
────────────────────────────────────────────────────────────── */
function SearchSync({
  isSearchPage,
  setQuery,
  setDebouncedQ,
}: {
  isSearchPage: boolean
  setQuery: (q: string) => void
  setDebouncedQ: (q: string) => void
}) {
  const searchParams = useSearchParams()
  useEffect(() => {
    if (isSearchPage) {
      const q = searchParams.get('q') ?? ''
      setQuery(q)
      setDebouncedQ(q)
    }
  }, [isSearchPage, searchParams, setQuery, setDebouncedQ])
  return null
}

function fmtMins(m: number) {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

/* ── Theme toggle ────────────────────────────────────
   Cycles light → dark → system, and shows the icon for the state you are IN,
   which is the convention people already read correctly from every OS and
   editor: sun means "you are in light", not "press for light".

   Rendered as a placeholder until mounted. The server has no way to know the
   preference — it lives in localStorage — so rendering a sun on the server
   and a moon on the client is a hydration mismatch. Reserving the exact same
   box until mount keeps the row from shifting by a pixel. */
function ThemeToggle() {
  const preference = useThemeStore(s => s.preference)
  const cycleTheme = useThemeStore(s => s.cycleTheme)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const Icon  = preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor
  const label = preference === 'dark'
    ? 'Dark theme — switch to system'
    : preference === 'light'
      ? 'Light theme — switch to dark'
      : 'Following your system theme — switch to light'

  if (!mounted) return <div className="h-8 w-8" aria-hidden />

  return (
    <motion.button
      type="button"
      onClick={cycleTheme}
      whileTap={{ scale: 0.92 }}
      title={label}
      aria-label={label}
      className="relative hidden h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)] sm:flex lg:h-8 lg:w-8"
      style={{ color: 'var(--color-text-secondary)' }}>
      {/* Cross-fade with a small rotation — enough to feel deliberate, short
          enough not to delay the theme change it is describing. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={preference}
          initial={{ opacity: 0, rotate: -35, scale: 0.7 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 35, scale: 0.7 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="absolute inset-0 flex items-center justify-center">
          <Icon size={16} />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

export function ClientTopbar() {
  const { setMobileNav } = useUIStore()
  const aiChatOpen    = useUIStore(s => s.aiChatOpen)
  const setAiChatOpen = useUIStore(s => s.setAiChat)
  const pathname = usePathname()
  const router = useRouter()
  const isSearchPage = pathname === '/search'

  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  /* Debounce the query for typeahead (skip on search page — results shown inline) */
  useEffect(() => {
    if (isSearchPage) return
    const t = setTimeout(() => setDebouncedQ(query), 280)
    return () => clearTimeout(t)
  }, [query, isSearchPage])

  /* Close dropdown on outside click */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const { data: suggestions, isFetching } = useTypeahead(debouncedQ)
  const showDropdown = focused && !isSearchPage && debouncedQ.trim().length >= 2
  const { data: user } = useCurrentUser()
  const { data: notifData } = useNotifications({ per_page: 8 })
  const { data: unreadCount } = useUnreadCount()
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()
  const notifications: Notification[] = notifData?.items ?? []
  const unread = unreadCount ?? notifData?.unreadCount ?? 0

  const displayName = user?.name ?? 'Account'
  const displayRole = user?.headline ?? (user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Student')
  const avatarInitial = (user?.name?.trim()?.[0] ?? '?').toUpperCase()
  const hasAvatarImage = !!user?.avatarUrl

  const isMobile = useIsMobile()
  /* Desktop sidebar removed — topbar always spans full width */
  const left = 0
  /* Always show full nav tabs in the topbar */
  const tabs = TOPBAR_TABS
  const cartCount = useCartStore(s => s.items.length)

  /* Same teardown the mobile drawer does: end the session, drop the local cart
     so the next account does not inherit it, and hard-navigate so no cached
     React Query data survives the switch. */
  const handleLogout = async () => {
    await apiLogout()
    localStorage.removeItem('lms-cart')
    window.location.href = '/login'
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <>
      <motion.header
        /* ── Slides in from top on mount ── */
        initial={{ y: -100, opacity: 0 }}
        animate={{ left, y: 0, opacity: 1 }}
        transition={{ y: { type: 'spring', stiffness: 280, damping: 28, mass: 0.8 }, left: { type: 'spring', stiffness: 300, damping: 30 } }}
        className="fixed top-0 right-0 z-30 bg-[var(--color-bg-surface)]"
        style={{ borderBottom: '1px solid var(--color-border)' }}>

        {/* ── Row 1: Logo (topbar mode) + search + actions ── */}
        {/* MEASURED AT 375px, WHERE THIS ROW DID NOT FIT. Its contents ended at
            411px in a 375px viewport, so the signed-in avatar was sliced in
            half by the right edge on every screen in the app, and a stray
            border-left hung past it. Nothing scrolled - the overflow was
            simply cut, which is the version of this bug you do not notice
            while developing at desktop width.

            The 52px had to come from somewhere, so it comes from five places
            that each cost nothing on a phone: a 60px row instead of 68, a
            30px logo instead of 38, 8px gaps instead of 12, no padding around
            the avatar, and the sign-out group hidden (it is in the drawer,
            two inches from the thumb). Everything returns at `sm`.
            --app-header-h in globals.css follows this height - the two are
            one number in two files. */}
        <div className="flex h-[60px] items-center gap-2 px-4 sm:h-[68px] sm:gap-5 sm:px-8" style={{ borderBottom: '1px solid var(--color-border)' }}>

          {/* Hamburger — always shown on mobile for the mobile drawer */}
          <button
            onClick={() => setMobileNav(true)}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)] lg:hidden"
            style={{ color: 'var(--color-primary)' }}
            aria-label="Open menu">
            <Menu size={18} />
          </button>

          {/* Logo — always visible (no desktop sidebar) */}
          <div className="flex items-center mr-1 sm:mr-6 flex-shrink-0">
            {/* 38px in a 68px row — 56%, inside the 45-60% band a nav logo
                should occupy. The row grew with it so the extra height buys
                presence rather than crowding: 15px clear above and below.
                On a phone the ratio is held rather than the pixel count:
                30px in a 60px row is 50%, still inside the band, and the 18px
                it gives back is 18px the avatar is no longer pushed off by. */}
            <img
              src="/logo-dark.png"
              alt="Delta International"
              className="h-[30px] w-auto object-contain sm:h-[38px]"
            />
          </div>

          {/* Search — live typeahead, syncs with /search page */}
          {/* Search as an icon on phones, as a field from `sm` up.

              Sharing row 1 with the logo and the action cluster left the
              field about 55px wide at 375px — narrower than the placeholder,
              and too small to type into. Rather than steal a second row of
              header height on the smallest screens, it collapses to a normal
              44px control that opens /search, which has a full-width input of
              its own. */}
          <Link href="/search" aria-label="Search courses"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-hover)] sm:hidden"
            style={{ color: 'var(--color-primary)' }}>
            <Search size={18} />
          </Link>

          {/* Capped rather than free-flowing: past ~460px a single-line search
              field stops reading as a control and starts reading as a gap. */}
          {/* min-w 200 was a floor the row could not always afford. Between
              `sm` and `lg` the header carries the hamburger, the logo and the
              action cluster as well, and 200px of search on top of those put
              the row 147px past a 700px screen - a real horizontal scroll on
              every page, not a clipped edge. flex-1 still gives the field
              everything left over (about 240px at 700, 274 at 1024); the
              floor just stops it demanding space that is not there. */}
          <div className="relative hidden flex-1 sm:block sm:min-w-[150px] sm:max-w-[460px]">
            <form
              onSubmit={e => {
                e.preventDefault()
                setFocused(false)
                const q = query.trim()
                router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
              }}>
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10"
                style={{ color: 'var(--color-primary)', opacity: focused ? 1 : 0.55 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => {
                  setQuery(e.target.value)
                  /* On /search page update URL in place so results refresh */
                  if (isSearchPage) {
                    const v = e.target.value.trim()
                    router.replace(v ? `/search?q=${encodeURIComponent(v)}` : '/search')
                  }
                }}
                onFocus={() => setFocused(true)}
                onKeyDown={e => { if (e.key === 'Escape') { setFocused(false); inputRef.current?.blur() } }}
                placeholder="Search courses…"
                className="h-11 w-full rounded-xl pl-10 pr-10 text-sm outline-none transition-all"
                style={{
                  background: focused ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)',
                  border: focused ? '1.5px solid #0057b8' : '1.5px solid transparent',
                  boxShadow: focused ? '0 0 0 3px rgba(0,87,184,0.10)' : 'none',
                  color: 'var(--color-text-primary)',
                }} />
              {query && (
                <button type="button"
                  onClick={() => {
                    setQuery(''); setDebouncedQ('')
                    if (isSearchPage) router.replace('/search')
                    inputRef.current?.focus()
                  }}
                  className="absolute right-9 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-md hover:bg-gray-200 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <X size={11} />
                </button>
              )}
              {/* <motion.button
              type="submit"
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-white"
              style={{ background: 'var(--color-primary)', boxShadow: '0 2px 8px rgba(0,87,184,0.30)' }}>
              <Search size={12} />
            </motion.button> */}
            </form>

            {/* ── Typeahead dropdown (only on non-search pages) ── */}
            <AnimatePresence>
              {showDropdown && (
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="absolute left-0 right-0 top-full mt-1.5 rounded-2xl overflow-hidden z-50 bg-[var(--color-bg-surface)]"
                  style={{ border: '1px solid var(--color-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.10)' }}>

                  {isFetching && !suggestions?.length ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      <Search size={12} className="animate-pulse" />
                      Searching…
                    </div>
                  ) : suggestions && suggestions.length === 0 ? (
                    <div className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      No courses found for &ldquo;{debouncedQ}&rdquo;
                    </div>
                  ) : (
                    <>
                      {suggestions?.map(course => (
                        <Link
                          key={course.id}
                          href={`/courses/${course.slug}`}
                          onClick={() => { setFocused(false); setQuery(course.title) }}>
                          <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-hover)] cursor-pointer"
                            style={{ borderBottom: '1px solid var(--color-bg-subtle)' }}>
                            {/* Thumbnail */}
                            <div className="h-10 w-14 flex-shrink-0 overflow-hidden rounded-lg"
                              style={{ background: 'var(--color-bg-subtle)' }}>
                              {course.thumbnailUrl
                                ? <img src={course.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                                : <div className="flex h-full w-full items-center justify-center">
                                  <BookOpen size={14} style={{ color: 'var(--color-text-muted)' }} />
                                </div>}
                            </div>
                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                                {course.title}
                              </p>
                              <div className="mt-0.5 flex items-center gap-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                                {course.ratingAvg > 0 && (
                                  <span className="flex items-center gap-0.5" style={{ color: 'var(--color-warning)' }}>
                                    <Star size={9} fill="#F59E0B" />{course.ratingAvg.toFixed(1)}
                                  </span>
                                )}
                                <span className="flex items-center gap-0.5">
                                  <Users size={9} />{course.enrolledCount.toLocaleString()}
                                </span>
                                {course.durationMins > 0 && (
                                  <span className="flex items-center gap-0.5">
                                    <Clock size={9} />{fmtMins(course.durationMins)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </Link>
                      ))}
                      {/* View all results */}
                      <Link
                        href={`/search?q=${encodeURIComponent(debouncedQ)}`}
                        onClick={() => setFocused(false)}
                        className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors hover:bg-[var(--color-hover)]"
                        style={{ color: 'var(--color-primary)', borderTop: '1px solid var(--color-border)' }}>
                        <Search size={11} />
                        View all results for &ldquo;{debouncedQ}&rdquo;
                      </Link>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Ask AI — orange primary */}
            <motion.button
              onClick={() => setAiChatOpen(!aiChatOpen)}
              whileHover={{ scale: 1.02, boxShadow: '0 6px 20px rgba(0,87,184,0.35)' }} whileTap={{ scale: 0.97 }}
              className="hidden lg:flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white"
              style={{ background: 'var(--color-primary)', boxShadow: '0 3px 12px rgba(0,87,184,0.22)' }}>
              <Sparkles size={12} />Ask AI
            </motion.button>

            {/* Help & Support — hidden on phones. Six icon buttons plus the
                logo and search did not fit at 375px: the cluster ran to 437px
                and the last controls sat off-screen with no way to scroll to
                them. This one is a row in the drawer nav, so nothing is lost. */}
            {/* `lg`, not `sm`: between those two the drawer is the navigation
                and it already carries Help & Support, so this is a duplicate
                that costs 50px the row does not have. */}
            <Link href="/support" className="hidden lg:block">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-hover)] lg:h-9 lg:w-9"
                style={{ color: 'var(--color-primary)' }}>
                <MessageSquare size={16} />
              </motion.div>
            </Link>

            {/* Cart */}
            <Link href="/cart">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                className="relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-hover)] lg:h-9 lg:w-9"
                style={{ color: 'var(--color-primary)' }}>
                <ShoppingCart size={16} />
                <AnimatePresence>
                  {cartCount > 0 && (
                    <motion.span
                      key="cart-badge"
                      initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                      transition={{ type: 'spring', stiffness: 400 }}
                      className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                      style={{ background: 'var(--color-primary)' }}>
                      {cartCount}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            </Link>

            {/* Purchase history - beside the cart, because that is where someone
                looks for what they bought, and the receipt for it.

                /orders is a complete "Purchase History" page that had no link
                anywhere in the client, at any width. A student could pay for a
                course and then never see the receipt again. It is an icon rather
                than a twelfth tab because the tab row already overflows, and
                because cart-then-receipts reads as one group. */}
            {/* Hidden on the LINK, not on the div inside it: a hidden child
                still leaves its parent in the flex row, collecting a gap. */}
            <Link href="/orders" className="hidden lg:block">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                title="Purchase history"
                aria-label="Purchase history"
                className="relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-hover)] lg:h-9 lg:w-9"
                style={{ color: 'var(--color-primary)' }}>
                <Receipt size={16} />
              </motion.div>
            </Link>

            {/* Notifications */}
            <div className="relative">
              <motion.button onClick={() => setNotifOpen(v => !v)}
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                className="relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-hover)] lg:h-9 lg:w-9"
                style={{ color: 'var(--color-primary)' }}>
                <Bell size={16} />
                {unread > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                    className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                    style={{ background: 'var(--color-danger)' }}>
                    {unread}
                  </motion.span>
                )}
              </motion.button>

              {/* The click-catcher leaves AnimatePresence: it has no exit
                  animation to run, so it does not belong in there, and that
                  leaves the panel as a single keyed child AnimatePresence can
                  actually track. */}
              {notifOpen && (
                <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              )}
              <AnimatePresence>
                {notifOpen && (
                    <motion.div
                      key="notif-panel"
                      initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.96 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      /* ANCHORED TO THE SCREEN ON A PHONE, NOT TO THE BELL.
                         `w-[calc(100vw-2rem)]` is 343px, but `absolute right-0`
                         pinned it to the bell's right edge at x=303 - so it
                         spanned -40 to 303 and its first 40px, the unread dot
                         and half the icon column, were off the left of the
                         screen. Pinning both edges to the viewport puts it
                         where it belongs; from `sm` it goes back to hanging
                         off the bell. The height cap is dvh so the last row
                         cannot end up under Safari's toolbar unreachable. */
                      className="fixed left-4 right-4 top-[calc(var(--app-header-h)+4px)] z-50 max-h-[70dvh] overflow-y-auto overscroll-contain rounded-2xl bg-[var(--color-bg-surface)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[70vh] sm:w-72"
                      style={{ border: '1px solid var(--color-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
                      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Notifications</span>
                        {unread > 0 && (
                          <button
                            onClick={() => markAllRead.mutate()}
                            disabled={markAllRead.isPending}
                            className="text-[11px] font-semibold transition-opacity hover:opacity-70 disabled:opacity-50"
                            style={{ color: 'var(--color-primary)' }}>
                            Mark all read
                          </button>
                        )}
                      </div>
                      {notifications.length === 0 && (
                        <p className="px-4 py-8 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          You&apos;re all caught up.
                        </p>
                      )}
                      {notifications.map((n, i) => {
                        const isUnread = !n.readAt
                        const inner = (
                          <div className="flex gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-hover)] cursor-pointer"
                            style={{ borderBottom: i < notifications.length - 1 ? '1px solid var(--color-bg-subtle)' : 'none' }}>
                            <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ background: isUnread ? '#0057b8' : 'var(--color-border)' }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs leading-relaxed font-semibold" style={{ color: isUnread ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{n.title}</p>
                              {n.body && (
                                <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>{n.body}</p>
                              )}
                              <p className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{relTime(n.createdAt)}</p>
                            </div>
                          </div>
                        )
                        const onClick = () => {
                          if (isUnread) markRead.mutate(n.id)
                          setNotifOpen(false)
                        }
                        /* A notification may now point somewhere outside the
                           app: the class-has-started reminder links straight
                           to the meeting room. next/link would navigate the
                           whole SPA away to meet.google.com, so the student
                           loses the app to join a class they are about to
                           come back from. An external target opens the room
                           beside it instead. */
                        const isExternal = /^https?:\/\//i.test(n.link ?? '')
                        return n.link
                          ? <motion.div key={n.id}
                            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04 }}>
                            {isExternal
                              ? <a href={n.link} target="_blank" rel="noopener noreferrer" onClick={onClick}>{inner}</a>
                              : <Link href={n.link} onClick={onClick}>{inner}</Link>}
                          </motion.div>
                          : <motion.div key={n.id}
                            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04 }}
                            onClick={onClick}>
                            {inner}
                          </motion.div>
                      })}
                    </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Theme — sits with the other utility icons rather than beside the
                avatar, because it is a preference about the app, not about the
                account. Same 34px square and same hover treatment as its
                neighbours so it reads as one row, not an afterthought. */}
            <ThemeToggle />

            {/* Profile */}
            <Link href="/settings">
              <div className="flex cursor-pointer items-center gap-2.5 rounded-xl px-0 py-1 transition-colors hover:bg-[var(--color-hover)] sm:px-2">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white ring-2 ring-blue-100 lg:h-9 lg:w-9"
                  style={{ background: 'var(--color-primary)' }}>
                  <AvatarImg src={user?.avatarUrl}
                    className="h-full w-full object-cover"
                    fallback={avatarInitial} />
                </div>
                <div className="hidden max-w-[160px] lg:block">
                  <p className="truncate text-xs font-semibold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{displayName}</p>
                  <p className="truncate text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{displayRole}</p>
                </div>
              </div>
            </Link>

            {/* Sign out — last, and behind a hairline rule.

                Placed AFTER the avatar because it acts on the account the
                avatar names; grouped with the utility icons it would read as
                another app control and get mis-clicked. The rule is what stops
                it looking bolted on: it closes the identity group rather than
                extending the icon row. Red only on hover, so a destructive
                action is never the loudest thing in the bar. */}
            <div className="ml-1 hidden items-center gap-1 pl-1.5 lg:flex"
              style={{ borderLeft: '1px solid var(--color-border)' }}>
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                aria-label="Sign out"
                /* Same hover wash as every other icon in the bar so the row
                   reads as one control group — just tinted danger rather than
                   brand, which is the only cue that sets it apart. */
                className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover-danger)] lg:h-8 lg:w-8"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}>
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Sync search input with /search?q= (Suspense-isolated) ── */}
        <Suspense fallback={null}>
          <SearchSync isSearchPage={isSearchPage} setQuery={setQuery} setDebouncedQ={setDebouncedQ} />
        </Suspense>

        {/* ── Row 2: Nav tabs — scrollable on mobile ── */}
        {/* ── Row 2: Nav tabs — desktop only ──────────────────────────────
            Hidden below `md`. On a phone these nine labels became a
            horizontally-scrolling strip where the items past "Catalog" were
            invisible unless you knew to swipe — a nav you cannot see is not a
            nav. Every one of these links is already in the hamburger drawer
            (see ClientSidebar), so nothing becomes unreachable; it just moves
            somewhere a thumb can actually get at it.

            44px tall, which is both the minimum touch target and the number
            --app-header-h is built from. */}
        <div className="hidden h-[44px] items-stretch overflow-x-auto px-4 scrollbar-none md:flex sm:px-8">
          {tabs.map((tab, i) => {
            const active = isActive(tab.href)
            return (
              <Link key={tab.href} href={tab.href} className="shrink-0">
                <motion.div
                  initial={{ opacity: 0, y: -16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.05 + i * 0.04 }}
                  className="relative flex h-[44px] items-center gap-1.5 px-3.5 sm:px-4 cursor-pointer select-none">
                  <span className="whitespace-nowrap text-sm font-medium transition-colors"
                    style={{ color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontWeight: active ? 600 : 400 }}>
                    {tab.label}
                  </span>
                  {tab.badge && (
                    <span aria-label={`${tab.badge} items`}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ background: 'var(--color-primary)' }}>
                      <span aria-hidden="true">{tab.badge}</span>
                    </span>
                  )}
                  {active && (
                    <motion.div layoutId="tab-underline"
                      className="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-full"
                      style={{ background: 'var(--color-primary)' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                  )}
                </motion.div>
              </Link>
            )
          })}
        </div>
      </motion.header>

      {/* ── AI Chat slide-out ── */}
      <AIChatPanel open={aiChatOpen} onClose={() => setAiChatOpen(false)} />
    </>
  )
}
