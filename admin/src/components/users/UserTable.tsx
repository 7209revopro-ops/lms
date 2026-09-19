'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Mail, Calendar, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight, MoreHorizontal, ShieldCheck, ShieldOff, ArrowUp, ArrowDown, Pencil, Eye,
} from 'lucide-react'
import { useUsers, useUpdateUser, useImpersonateClient, type AdminUser } from '@/lib/api/users'
import { useCurrentUser } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { useToast } from '@/store/ui.store'
import { EditStudentModal } from '@/components/users/EditStudentModal'
import { EditInstructorModal } from '@/components/instructors/EditInstructorModal'
import { StudentHistoryModal } from '@/components/users/StudentHistoryModal'
import { CrossAcademyBadge, crossAccent } from '@/components/ui/CrossAcademyBadge'

interface Props {
  role:  'student' | 'instructor'
  label: string
}

type CategoryFilter = '' | '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | 'jura'

const CATEGORY_LABELS: Record<string, string> = {
  '4x-trading':        'FOREX',
  'jura':              'JURA',
  'digital-marketing': 'Digital Marketing',
  'ai':                'AI',
}

const CATEGORY_STYLE: Record<string, { bg: string; color: string }> = {
  '4x-trading':        { bg: 'rgba(16,185,129,0.12)',  color: '#10B981' },
  'jura':              { bg: 'rgba(139,92,246,0.12)', color: '#8B5CF6' },
  'digital-marketing': { bg: 'rgba(0,87,184,0.12)',  color: '#0057b8' },
  'ai':                { bg: 'rgba(139,92,246,0.12)',   color: '#8B5CF6' },
}

function fmtDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function UserTable({ role, label }: Props) {
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(1)
  const [category,    setCategory]    = useState<CategoryFilter>('')
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [historyUser, setHistoryUser] = useState<AdminUser | null>(null)

  const { data, isLoading } = useUsers(role, {
    search,
    page,
    per_page: 20,
    category: category || undefined,
  })

  const handleCategoryFilter = (cat: CategoryFilter) => {
    setCategory(cat)
    setPage(1)
  }

  return (
    <div>
      {/* ── Search + filter row ── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="w-full rounded-xl py-2 pl-9 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/25"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            onFocus={e => { e.currentTarget.style.border = '1px solid rgba(0,87,184,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.10)' }}
            onBlur={e => { e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none' }} />
        </div>

        {/* Category filter chips */}
        <div className="flex items-center gap-1.5">
          {(['', '4x-trading', 'digital-marketing', 'ai', 'jura'] as CategoryFilter[]).map(cat => {
            const s = cat ? CATEGORY_STYLE[cat] : null
            return (
              <button
                key={cat || 'all'}
                onClick={() => handleCategoryFilter(cat)}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                style={category === cat
                  ? { background: s ? `${s.bg}` : 'rgba(0,87,184,0.18)', color: s?.color ?? '#0057b8', border: `1px solid ${s?.color ?? '#0057b8'}50` }
                  : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.07)' }}>
                {cat === '' ? 'All' : CATEGORY_LABELS[cat]}
              </button>
            )
          })}
        </div>

        <p className="ml-auto text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {data && `${data.meta.total_count.toLocaleString()} ${label.toLowerCase()}`}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              {['Name', 'Email', 'Category', 'Status', 'Joined', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left"
                  style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-12 text-center">
                <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <Spinner size={14} />Loading…
                </div>
              </td></tr>
            )}
            {!isLoading && data?.docs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
                No {label.toLowerCase()} found
              </td></tr>
            )}
            {!isLoading && data?.docs.map((u, i) => (
              <UserRow key={u.id} user={u} index={i} onEdit={setEditingUser}
                onViewHistory={role === 'student' ? setHistoryUser : undefined} />
            ))}
          </tbody>
        </table>
        </div>

        {data && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Page {page} of {data.meta.total_pages}
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!data.meta.has_prev}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/08 disabled:opacity-30"
                style={{ color: 'rgba(255,255,255,0.6)' }}>
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={!data.meta.has_next}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/08 disabled:opacity-30"
                style={{ color: 'rgba(255,255,255,0.6)' }}>
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal rendered outside <table> to avoid invalid DOM nesting */}
      {editingUser && role === 'student' && (
        <EditStudentModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={() => setEditingUser(null)}
        />
      )}
      {editingUser && role === 'instructor' && (
        <EditInstructorModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={() => setEditingUser(null)}
        />
      )}
      {historyUser && (
        <StudentHistoryModal
          user={historyUser}
          onClose={() => setHistoryUser(null)}
        />
      )}
    </div>
  )
}

function UserRow({ user, index, onEdit, onViewHistory }: {
  user:          AdminUser
  index:         number
  onEdit:        (u: AdminUser) => void
  onViewHistory?: (u: AdminUser) => void
}) {
  const update    = useUpdateUser()
  const toast     = useToast()
  const viewAs    = useImpersonateClient()
  const { data: me } = useCurrentUser()
  const [menuOpen, setMenuOpen] = useState(false)

  /* super_admin only, students only — the same two rules the backend enforces.
     Hiding it here is a courtesy; the endpoint is the actual control. */
  const canViewAsStudent = me?.role === 'super_admin' && user.role === 'student'

  /* Only an instructor can be lent: sharedInstructorFilter on the backend keys
     the widening on `role: 'instructor'` as part of the clause rather than
     assuming it, so the flag is meaningless on any other role and must not be
     drawn there. */
  const isLent = user.role === 'instructor' && !!user.sharedAcrossOrgs

  const viewAsStudent = async () => {
    setMenuOpen(false)
    if (!confirm(
      `Open the student portal as ${user.name}?

` +
      'The session is READ-ONLY, lasts 30 minutes, and is recorded against your account. ' +
      'It opens in a new tab and does not affect your own sessions.',
    )) return
    try {
      const handoff = await viewAs.mutateAsync(user.id)
      /* Opened immediately in the click handler's own turn — a popup blocker
         would eat a window opened later from an async continuation. */
      const opened = window.open(handoff.clientUrl, '_blank', 'noopener,noreferrer')
      if (!opened) {
        toast.error('Allow pop-ups to open the student portal',
          'The link expires in 60 seconds, so try again once pop-ups are allowed.')
        return
      }
      toast.success(`Opening the student portal as ${handoff.user.name}`)
    } catch (err: any) {
      toast.error('Could not start the session', err?.response?.data?.error?.message)
    }
  }

  const setActive = async (active: boolean) => {
    setMenuOpen(false)
    if (!active && !confirm(`Deactivate ${user.name}? They will be signed out everywhere.`)) return
    try {
      await update.mutateAsync({ id: user.id, isActive: active })
      toast.success(active ? 'User activated' : 'User deactivated')
    } catch (err: any) {
      toast.error('Could not update user', err?.response?.data?.error?.message)
    }
  }

  const setRole = async (role: AdminUser['role']) => {
    setMenuOpen(false)
    if (!confirm(`Change ${user.name}'s role to "${role}"?`)) return
    try {
      await update.mutateAsync({ id: user.id, role })
      toast.success(`Role set to ${role}`)
    } catch (err: any) {
      toast.error('Could not update role', err?.response?.data?.error?.message)
    }
  }

  // Support multi-category display
  const displayCats: string[] = (user as any).categories?.length
    ? (user as any).categories
    : user.category ? [user.category] : []

  return (
    <>
    <motion.tr
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.025 }}
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
      <td className="px-4 py-3.5">
        {onViewHistory ? (
          <button
            onClick={() => onViewHistory(user)}
            title="View student history"
            className="flex items-center gap-3 rounded-lg text-left transition-colors hover:bg-white/05"
            style={{ margin: '-4px', padding: '4px' }}>
            {/* A lent instructor wears the cross-academy accent on the ring
                itself, so a list of forty can be scanned without reading a
                single badge. */}
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
              style={isLent
                ? { background: crossAccent.bg, border: crossAccent.border }
                : { background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
              <AvatarImg src={user.avatarUrl} name={user.name}
                className="h-full w-full object-cover"
                fallbackClassName="text-xs font-bold"
                fallbackStyle={{ color: '#0057b8' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                {isLent && (
                  <CrossAcademyBadge
                    label="Both academies"
                    title="Lent to the other academy. Both may list this instructor and schedule classes for them; they stay owned by their own academy for reporting."
                  />
                )}
              </div>
              {user.headline && (
                <p className="mt-0.5 truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.35)', maxWidth: 240 }}>
                  {user.headline}
                </p>
              )}
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-3">
            {/* A lent instructor wears the cross-academy accent on the ring
                itself, so a list of forty can be scanned without reading a
                single badge. */}
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
              style={isLent
                ? { background: crossAccent.bg, border: crossAccent.border }
                : { background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
              <AvatarImg src={user.avatarUrl} name={user.name}
                className="h-full w-full object-cover"
                fallbackClassName="text-xs font-bold"
                fallbackStyle={{ color: '#0057b8' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                {isLent && (
                  <CrossAcademyBadge
                    label="Both academies"
                    title="Lent to the other academy. Both may list this instructor and schedule classes for them; they stay owned by their own academy for reporting."
                  />
                )}
              </div>
              {user.headline && (
                <p className="mt-0.5 truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.35)', maxWidth: 240 }}>
                  {user.headline}
                </p>
              )}
            </div>
          </div>
        )}
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
          <Mail size={12} />
          <span className="text-sm truncate max-w-[220px]">{user.email}</span>
        </div>
      </td>
      <td className="px-4 py-3.5">
        {displayCats.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {displayCats.map(cat => {
              const s = CATEGORY_STYLE[cat]
              return s ? (
                <span key={cat} className="inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: s.bg, color: s.color }}>
                  {CATEGORY_LABELS[cat] ?? cat}
                </span>
              ) : null
            })}
          </div>
        ) : (
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
        )}
      </td>
      <td className="px-4 py-3.5">
        <span className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold"
          style={user.isActive
            ? { background: 'rgba(74,222,128,0.12)', color: '#4ADE80' }
            : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
          {user.isActive
            ? <><CheckCircle2 size={11} />Active</>
            : <><XCircle size={11} />Inactive</>}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
          <Calendar size={11} />{fmtDate(user.createdAt)}
        </div>
      </td>
      <td className="px-4 py-3.5 relative">
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(user)}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/05"
            style={{ color: 'rgba(255,255,255,0.45)' }}
            title="Edit profile">
            <Pencil size={12} />
          </button>
          <button onClick={() => setMenuOpen(v => !v)} disabled={update.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/05 disabled:opacity-40"
            style={{ color: 'rgba(255,255,255,0.45)' }}>
            {update.isPending ? <Spinner size={12} /> : <MoreHorizontal size={13} />}
          </button>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <motion.div initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                className="absolute right-2 top-10 z-40 w-52 rounded-2xl p-1.5 z-50"
                style={{ background: '#13141C', border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}>
                {canViewAsStudent && (
                  <button onClick={viewAsStudent} disabled={viewAs.isPending}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/05 disabled:opacity-40"
                    style={{ color: '#60A5FA' }}>
                    {viewAs.isPending ? <Spinner size={12} /> : <Eye size={12} />}
                    View as student
                  </button>
                )}
                <button onClick={() => setActive(!user.isActive)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/05"
                  style={{ color: user.isActive ? '#F87171' : '#4ADE80' }}>
                  {user.isActive ? <><ShieldOff size={12} />Deactivate</> : <><ShieldCheck size={12} />Activate</>}
                </button>
                {user.role !== 'instructor' && (
                  <button onClick={() => setRole('instructor')}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/05"
                    style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <ArrowUp size={12} />Make instructor
                  </button>
                )}
                {user.role !== 'student' && (
                  <button onClick={() => setRole('student')}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/05"
                    style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <ArrowDown size={12} />Demote to student
                  </button>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </td>
    </motion.tr>
    </>
  )
}
