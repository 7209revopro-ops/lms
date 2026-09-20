'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Bell, Plus, ChevronDown, X, BookOpen, Users, GraduationCap, Menu, UserCog, LogOut, Building2, Check } from 'lucide-react'
import Link from 'next/link'
import { useUIStore } from '@/store/ui.store'
import { useCurrentUser, logout } from '@/lib/api/user'
import { useRouter } from 'next/navigation'
import { useImpersonationStore } from '@/store/impersonation.store'
import { PROGRAM_LABEL } from '@/lib/programScope'
import { useOrgStore } from '@/store/org.store'
import { useOrganizations } from '@/lib/api/organizations'
import { AvatarImg } from '@/components/ui/AvatarImg'

const notifications = [
  { id: 1, type: 'enroll',     text: 'New enrollment: UI/UX Design Mastery', time: '2m ago',  unread: true },
  { id: 2, type: 'review',     text: 'New 5★ review on TypeScript course',   time: '14m ago', unread: true },
  { id: 3, type: 'instructor', text: 'Alex Kim submitted new course draft',   time: '1h ago',  unread: false },
  { id: 4, type: 'enroll',     text: '25 new students this hour',             time: '2h ago',  unread: false },
]

/* Same hues the enrolment screens use for these programmes, so one person
   reads as the same colour wherever they appear. */
const SCOPE_COLOR: Record<string, string> = {
  forex:             '#10B981',
  digital_marketing: '#0057b8',
  ai:                '#8B5CF6',
  jura:              '#8B5CF6',
}

export function AdminTopbar() {
  const { setMobileNav } = useUIStore()
  const [searchOpen,  setSearchOpen]  = useState(false)
  const [notifOpen,   setNotifOpen]   = useState(false)
  const [quickOpen,   setQuickOpen]   = useState(false)
  const [avatarOpen,  setAvatarOpen]  = useState(false)
  const [orgOpen,     setOrgOpen]     = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const unreadCount = notifications.filter(n => n.unread).length

  const { data: user } = useCurrentUser()
  const router = useRouter()
  const avatarInitial = (user?.name?.trim()?.[0] ?? '?').toUpperCase()
  const { impersonatedUser, endImpersonation } = useImpersonationStore()

  const isSuperAdmin = user?.role === 'super_admin'
  const { activeOrgId, activeOrgName, setOrg, clearOrg } = useOrgStore()
  const { data: orgs = [] } = useOrganizations(isSuperAdmin)

  const handleLogout = async () => {
    await logout()
    router.replace('/login')
  }

  return (
    /* -- The 375px budget -------------------------------------------------
       Measured as coded: the row needed 429px for an admin, 572px with the
       super-admin org switcher and 678px with a sub-admin's scope badge. The
       header is `fixed`, so that overflow produced NO document scrollWidth --
       the avatar (the only way to sign out from up here) simply sat past the
       right edge, at 377->409px on a 375px screen, with no way to reach it.
       Nothing shrank on its own: `flex-1` keeps min-width:auto, so the search
       trigger held its 144px min-content, and both badges were flex-shrink-0.

       So below `sm` the search trigger is dropped (it is a dead control --
       `searchQuery` is never read), Create goes icon-only, and the scope
       badge waits for `md`; the org switcher and the impersonation banner
       keep their controls and truncate their labels instead of disappearing.
       Worst case on a phone is now 344px: super admin, impersonating.

       `left` follows --admin-sb from the dashboard layout through a `lg:`
       class, for the same first-paint reason documented over there. */
    <header
      className="fixed top-0 right-0 left-0 z-30 flex h-[60px] items-center gap-2 px-3 transition-[left] duration-300 ease-out sm:gap-3 sm:px-5 lg:left-[var(--admin-sb)]"
      style={{ background: 'rgba(8,10,18,0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
    >
      {/* ── Hamburger (mobile only) ─────────────────── */}
      <button
        onClick={() => setMobileNav(true)}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/10 lg:hidden"
        style={{ color: 'rgba(255,255,255,0.6)' }}
        aria-label="Open menu">
        <Menu size={18} />
      </button>

      {/* ── Search ──────────────────────────────────── */}
      <div className="relative hidden max-w-[480px] flex-1 sm:block">
        <AnimatePresence mode="wait">
          {searchOpen ? (
            <motion.div key="open" initial={{ opacity: 0, scaleX: 0.9 }} animate={{ opacity: 1, scaleX: 1 }}
              exit={{ opacity: 0, scaleX: 0.9 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="flex items-center gap-2 rounded-xl px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(0,87,184,0.5)', boxShadow: '0 0 0 3px rgba(0,87,184,0.10)' }}>
              <Search size={14} style={{ color: '#0057b8' }} />
              <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search courses, students, instructors…"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                style={{ minWidth: 0 }}
              />
              <button onClick={() => { setSearchOpen(false); setSearchQuery('') }}
                className="transition-opacity hover:opacity-70" style={{ color: 'rgba(255,255,255,0.3)' }}>
                <X size={13} />
              </button>
            </motion.div>
          ) : (
            <motion.button key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-xl px-3 py-1.5 transition-colors hover:bg-white/5"
              style={{ color: 'rgba(255,255,255,0.35)' }}>
              <Search size={14} />
              <span className="text-sm">Search…</span>
              <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-mono"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}>⌘K</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Org switcher (super_admin only) ──────────── */}
      {isSuperAdmin && (
        <div className="relative min-w-[76px] shrink">
          <motion.button
            type="button"
            onClick={() => { setOrgOpen(v => !v); setNotifOpen(false); setQuickOpen(false); setAvatarOpen(false) }}
            whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
            className="flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
            style={activeOrgId
              ? { background: 'rgba(0,87,184,0.14)', border: '1px solid rgba(0,87,184,0.4)', color: '#60A5FA' }
              : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.55)' }}>
            <Building2 size={12} className="flex-shrink-0" />
            <span className="truncate">{activeOrgName ?? 'All Orgs'}</span>
            <ChevronDown size={11} style={{ transform: orgOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
          </motion.button>

          <AnimatePresence>
            {orgOpen && (
              <>
                {/* h-screen, not inset-0. The header is a containing block for
                    its descendants because of backdropFilter, so `inset-0`
                    resolved to the HEADER's 60px band - the catcher covered
                    only the bar itself and a click anywhere in the page below
                    never closed the menu. */}
                <div className="fixed inset-x-0 top-0 z-[60] h-screen" onClick={() => setOrgOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.12 }}
                  className="absolute left-0 top-full mt-2 w-48 z-[61] overflow-hidden rounded-xl py-1"
                  style={{ background: '#131525', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}>
                  <button
                    type="button"
                    onClick={() => { clearOrg(); setOrgOpen(false) }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06]"
                    style={{ color: activeOrgId === null ? '#60A5FA' : 'rgba(255,255,255,0.7)' }}>
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                      {activeOrgId === null && <Check size={12} />}
                    </span>
                    <span className="truncate">All Organizations</span>
                  </button>
                  <div className="my-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  {orgs.map(org => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => { setOrg(org.id, org.name, org.slug); setOrgOpen(false) }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06]"
                      style={{ color: activeOrgId === org.id ? '#60A5FA' : 'rgba(255,255,255,0.7)' }}>
                      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                        {activeOrgId === org.id && <Check size={12} />}
                      </span>
                      <span className="truncate">{org.name}</span>
                      <span className="ml-auto text-[9px] font-mono opacity-40">{org.currency}</span>
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Programme scope badge ─────────────────────── */}
      {/* Reads the PROGRAMME, not the role name. This used to be a ladder of
          role comparisons because three roles each encoded their own
          programme; with those folded into sub_admin there is one rule and
          one colour table. A sub_admin with no programme set is genuinely
          unscoped, and says so rather than defaulting to a programme. */}
      {user && (user.role === 'sub_admin' || user.role === 'support') && (() => {
        const scope = user.role === 'support'
          ? { label: 'Support', color: '#FBBF24' }
          : user.program
            ? { label: `${PROGRAM_LABEL[user.program] ?? user.program} Sub-Admin`,
                color: SCOPE_COLOR[user.program] ?? '#94A3B8' }
            : { label: 'Sub-Admin · no programme', color: '#94A3B8' }
        const rgb = scope.color
        return (
          <div className="hidden min-w-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold md:flex"
            style={{ background: `${rgb}1F`, border: `1px solid ${rgb}4D`, color: rgb }}>
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: rgb }} />
            <span className="truncate">{scope.label} scope</span>
          </div>
        )
      })()}

      {/* ── Impersonation banner ────────────────────── */}
      {impersonatedUser && (
        <div className="flex min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold"
          style={{ background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.3)', color: '#FACC15' }}>
          <UserCog size={13} className="flex-shrink-0" />
          <span className="truncate">Viewing as <strong>{impersonatedUser.name}</strong></span>
          <button onClick={endImpersonation}
            aria-label="Stop viewing as this user"
            className="ml-1 flex-shrink-0 transition-opacity hover:opacity-70"
            style={{ color: 'rgba(250,204,21,0.7)' }}>
            <X size={12} />
          </button>
        </div>
      )}

      <div className="ml-auto flex flex-shrink-0 items-center gap-2">
        {/* ── Quick create ─────────────────────────── */}
        <div className="relative">
          <motion.button
            onClick={() => { setQuickOpen(v => !v); setNotifOpen(false) }}
            whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }}
            aria-label="Create"
            title="Create"
            className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-semibold text-white transition-all sm:px-3"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 16px rgba(0,87,184,0.30)' }}>
            <Plus size={14} />
            <span className="hidden sm:inline">Create</span>
            <ChevronDown size={12} style={{ transform: quickOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
          </motion.button>

          <AnimatePresence>
            {quickOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className="absolute right-0 top-full mt-2 w-48 rounded-2xl p-1.5 z-50"
                style={{ background: '#13162A', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                <Link href="/courses/new" onClick={() => setQuickOpen(false)}>
                  <div className="flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-white/5 cursor-pointer">
                    <BookOpen size={14} style={{ color: '#0057b8' }} />
                    <span className="text-sm font-medium text-white">New Course</span>
                  </div>
                </Link>
                <button type="button" className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-white/5"
                  onClick={() => { setQuickOpen(false); router.push('/students?add=1') }}>
                  <Users size={14} style={{ color: '#0057b8' }} />
                  <span className="text-sm font-medium text-white">Add Student</span>
                </button>
                <button type="button" className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-white/5"
                  onClick={() => { setQuickOpen(false); router.push('/instructors?add=1') }}>
                  <GraduationCap size={14} style={{ color: '#0057b8' }} />
                  <span className="text-sm font-medium text-white">Add Instructor</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Notifications ────────────────────────── */}
        <div className="relative">
          <motion.button
            onClick={() => { setNotifOpen(v => !v); setQuickOpen(false) }}
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="relative flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08]"
            style={{ color: 'rgba(255,255,255,0.55)' }}>
            <Bell size={16} />
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400 }}
                className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: '#0057b8' }}>
                {unreadCount}
              </motion.span>
            )}
          </motion.button>

          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-80 rounded-2xl z-50 overflow-hidden"
                style={{ background: '#13162A', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-sm font-semibold text-white">Notifications</span>
                  <button className="text-[11px] font-medium" style={{ color: '#0057b8' }}>Mark all read</button>
                </div>
                {notifications.map((n, i) => (
                  <motion.div key={n.id}
                    initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04] cursor-pointer"
                    style={{ borderBottom: i < notifications.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                    <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ background: n.unread ? 'rgba(0,87,184,0.15)' : 'rgba(255,255,255,0.05)' }}>
                      <Bell size={12} style={{ color: n.unread ? '#0057b8' : 'rgba(255,255,255,0.3)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed" style={{ color: n.unread ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)' }}>{n.text}</p>
                      <p className="mt-0.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{n.time}</p>
                    </div>
                    {n.unread && <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: '#0057b8' }} />}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Avatar + dropdown ────────────────────── */}
        <div className="relative">
          <motion.button
            onClick={() => { setAvatarOpen(v => !v); setNotifOpen(false); setQuickOpen(false) }}
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white ring-2 ring-transparent hover:ring-blue-600/40 transition-all"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}
            title={user?.email}>
            <AvatarImg src={user?.avatarUrl}
              className="h-full w-full object-cover"
              fallback={avatarInitial} />
          </motion.button>

          <AnimatePresence>
            {avatarOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-60 rounded-2xl z-50 overflow-hidden"
                style={{ background: '#13162A', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="truncate text-sm font-semibold text-white">{user?.name ?? 'Loading…'}</p>
                  <p className="mt-0.5 truncate text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{user?.email ?? ''}</p>
                  {user?.role && (
                    <span className="mt-2 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                      style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.25)' }}>
                      {user.role}
                    </span>
                  )}
                </div>
                <button onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.04]"
                  style={{ color: '#EF4444' }}>
                  <LogOut size={13} />Sign out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Backdrop for dropdowns */}
      {(notifOpen || quickOpen || avatarOpen) && (
        <div className="fixed inset-x-0 top-0 z-40 h-screen" onClick={() => { setNotifOpen(false); setQuickOpen(false); setAvatarOpen(false); setOrgOpen(false) }} />
      )}

    </header>
  )
}
