'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  Search, ChevronLeft, ChevronRight,
  Pencil, Trash2, Eye, UserPlus, ChevronDown,
} from 'lucide-react'
import {
  useUsers, useDeleteUser, useImpersonateUser, type AdminUser,
} from '@/lib/api/users'
import Spinner from '@/components/ui/Spinner'
import { useCurrentUser, type CurrentAdmin } from '@/lib/api/user'
import { useImpersonationStore } from '@/store/impersonation.store'
import { useToast } from '@/store/ui.store'
import { EditUserModal } from '@/components/users/EditUserModal'
import { UserViewModal } from '@/components/users/UserViewModal'
import { AddUserModal } from '@/components/users/AddUserModal'
import { AvatarImg } from '@/components/ui/AvatarImg'

const ROLE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  super_admin:              { bg: 'rgba(168,85,247,0.18)',   color: '#A855F7', label: 'Super Admin' },
  admin:                    { bg: 'rgba(251,146,60,0.14)',   color: '#FB923C', label: 'Admin' },
  sub_admin:                { bg: 'rgba(245,158,11,0.14)',   color: '#F59E0B', label: 'Sub Admin' },
  support:                  { bg: 'rgba(20,184,166,0.14)',   color: '#14B8A6', label: 'Support' },
  instructor:               { bg: 'rgba(99,102,241,0.14)',   color: '#818CF8', label: 'Instructor' },
  student:                  { bg: 'rgba(156,163,175,0.14)', color: '#9CA3AF', label: 'Student' },
}

const CATEGORY_LABELS: Record<string, string> = {
  '4x-trading':        'FOREX Trading',
  'jura':              'JURA',
  'digital-marketing': 'Digital Marketing',
  'ai':                'AI',
}

const CATEGORY_STYLE: Record<string, { bg: string; color: string }> = {
  '4x-trading':        { bg: 'rgba(96,165,250,0.12)',  color: '#60A5FA' },
  'jura':              { bg: 'rgba(139,92,246,0.12)', color: '#8B5CF6' },
  'digital-marketing': { bg: 'rgba(52,211,153,0.12)',  color: '#34D399' },
  'ai':                { bg: 'rgba(192,132,252,0.14)', color: '#C084FC' },
}

/* Program-scoped roles (sub_admin, *_admin) store their scope in `program`
   ('ai' | 'digital_marketing' | 'forex' | 'jura') rather than `category` — map it to
   the same slug space the category badge already renders. */
const PROGRAM_TO_CATEGORY: Record<string, string> = {
  forex:              '4x-trading',
  jura:               'jura',
  digital_marketing:  'digital-marketing',
  ai:                 'ai',
}

function fmtDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type RoleFilter   = 'all' | 'super_admin' | 'admin' | 'sub_admin' | 'support' | 'instructor'
type StatusFilter = 'all' | 'active' | 'inactive'

function getRoleOptions(myRole: string): { value: string; label: string }[] {
  switch (myRole) {
    case 'super_admin': return [
      { value: 'all',                     label: 'All Staff' },
      { value: 'super_admin',             label: 'Super Admin' },
      { value: 'admin',                   label: 'Admin' },
      { value: 'sub_admin',              label: 'Sub Admin' },
      { value: 'support',                label: 'Support' },
      { value: 'instructor',              label: 'Instructor' },
    ]
    case 'admin': return [
      { value: 'all',                     label: 'All Staff' },
      { value: 'sub_admin',              label: 'Sub Admin' },
      { value: 'support',                label: 'Support' },
      { value: 'instructor',              label: 'Instructor' },
    ]
    case 'sub_admin': return [
      { value: 'all',        label: 'All' },
      { value: 'instructor', label: 'Instructor' },
    ]
    case 'support': return [
      { value: 'all',        label: 'All' },
      { value: 'instructor', label: 'Instructor' },
    ]
    /* A programme-scoped sub_admin sees only instructors; the backend already
       filters the list to their programme, so no per-programme case is needed
       here the way the three role-encoded variants each required one. */
    case 'sub_admin': return [
      { value: 'all',        label: 'All' },
      { value: 'instructor', label: 'Instructor' },
    ]
    default: return [{ value: 'all', label: 'All Staff' }]
  }
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all',      label: 'All Status' },
  { value: 'active',   label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

function FilterDropdown({ value, options, onChange }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value) ?? options[0]
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition-all"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.7)' }}>
        {current?.label}
        <ChevronDown size={13} style={{
          color: 'rgba(255,255,255,0.4)',
          transform: open ? 'rotate(180deg)' : undefined,
          transition: 'transform 0.15s',
        }} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.12 }}
              className="absolute left-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-xl py-1"
              style={{ background: '#0F1020', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}>
              {options.map(o => (
                <button key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
                  className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.05]"
                  style={{ color: o.value === value ? '#0057b8' : 'rgba(255,255,255,0.75)' }}>
                  {o.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export function AdminUsersPanel() {
  const { data: me, isLoading: meLoading } = useCurrentUser()
  const router = useRouter()

  const [search,       setSearch]       = useState('')
  const [page,         setPage]         = useState(1)
  const [roleFilter,   setRoleFilter]   = useState<RoleFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [addOpen,      setAddOpen]      = useState(false)
  const [viewUser,     setViewUser]     = useState<AdminUser | null>(null)
  const [editUser,     setEditUser]     = useState<AdminUser | null>(null)

  useEffect(() => {
    if (!meLoading && me?.role === 'instructor') {
      router.replace('/courses')
    }
  }, [me, meLoading, router])

  const { data, isLoading } = useUsers(
    roleFilter === 'all' ? undefined : roleFilter,
    {
      search,
      page,
      per_page:         15,
      status:           statusFilter === 'all' ? undefined : statusFilter,
      exclude_students: true,
    },
  )

  if (meLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner size={20} variant="muted" />
      </div>
    )
  }

  if (!me || me.role === 'instructor') return null

  const roleOptions = getRoleOptions(me.role)
  // admin can manage everyone except super_admin users
  const canManageUser = (u: AdminUser) =>
    me.role === 'super_admin' || (me.role === 'admin' && u.role !== 'super_admin')

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ minWidth: 200, maxWidth: 360 }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search users…"
            className="w-full rounded-xl py-2 pl-9 pr-4 text-sm text-white outline-none transition-all placeholder:text-white/25"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            onFocus={e => { e.currentTarget.style.border = '1px solid rgba(0,87,184,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.10)' }}
            onBlur={e => { e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none' }}
          />
        </div>

        <FilterDropdown value={statusFilter} options={STATUS_OPTIONS} onChange={v => { setStatusFilter(v as StatusFilter); setPage(1) }} />
        <FilterDropdown value={roleFilter}   options={roleOptions}    onChange={v => { setRoleFilter(v as RoleFilter);   setPage(1) }} />

        <div className="flex-1" />

        {data && (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {data.meta.total_count.toLocaleString()} {roleFilter === 'all' ? 'staff' : roleFilter.replace('_', ' ')}
          </p>
        )}

        <motion.button
          onClick={() => setAddOpen(true)}
          whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#0057b8,#003d80)', boxShadow: '0 4px 14px rgba(0,87,184,0.28)' }}>
          <UserPlus size={14} />New User
        </motion.button>
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {['User', 'Role', 'Category', 'Status', 'Joined', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left"
                    style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-14 text-center">
                  <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    <Spinner size={14} />Loading users…
                  </div>
                </td></tr>
              )}
              {!isLoading && data?.docs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  No users found
                </td></tr>
              )}
              {!isLoading && data?.docs.map((u, i) => (
                <UserRow
                  key={u.id}
                  user={u}
                  index={i}
                  canManage={canManageUser(u)}
                  isSuperAdmin={me.role === 'super_admin'}
                  onView={() => setViewUser(u)}
                  onEdit={() => setEditUser(u)}
                />
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
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
                style={{ color: 'rgba(255,255,255,0.6)' }}>
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={!data.meta.has_next}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
                style={{ color: 'rgba(255,255,255,0.6)' }}>
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals rendered outside table to avoid invalid <div> inside <tbody> */}
      <AddUserModal me={me} open={addOpen} onClose={() => setAddOpen(false)} />

      {viewUser && (
        <UserViewModal user={viewUser} onClose={() => setViewUser(null)} />
      )}

      <AnimatePresence>
        {editUser && canManageUser(editUser) && (
          <EditUserModal
            user={editUser}
            me={me}
            onClose={() => setEditUser(null)}
            onSuccess={() => setEditUser(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Row — no modals rendered here, callbacks lift state to panel ── */
function UserRow({ user, index, canManage, isSuperAdmin, onView, onEdit }: {
  user:         AdminUser
  index:        number
  canManage:    boolean
  isSuperAdmin: boolean
  onView:       () => void
  onEdit:       () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const deleteUser  = useDeleteUser()
  const impersonate = useImpersonateUser()
  const toast       = useToast()
  const { token, impersonatedUser, startImpersonation } = useImpersonationStore()

  const isImpersonating = !!token && impersonatedUser?.id === user.id
  const roleStyle   = ROLE_STYLE[user.role] ?? ROLE_STYLE['admin']
  const displayCat  = user.category ?? (user.program ? PROGRAM_TO_CATEGORY[user.program] : undefined)
  const catStyle    = displayCat ? CATEGORY_STYLE[displayCat] : null

  const handleImpersonate = async () => {
    try {
      const result = await impersonate.mutateAsync(user.id)
      startImpersonation(result.token, result.user)
      toast.success(`Now viewing as ${user.name}`)
    } catch (err: any) {
      toast.error('Impersonation failed', err?.response?.data?.error?.message)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteUser.mutateAsync(user.id)
      toast.success(`${user.name} deleted`)
    } catch (err: any) {
      toast.error('Delete failed', err?.response?.data?.error?.message)
    } finally {
      setConfirmDelete(false)
    }
  }

  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}
      className="group transition-colors"
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: isImpersonating ? 'rgba(250,204,21,0.04)' : 'transparent',
      }}
      onMouseEnter={e => { if (!isImpersonating) e.currentTarget.style.background = 'rgba(255,255,255,0.025)' }}
      onMouseLeave={e => { e.currentTarget.style.background = isImpersonating ? 'rgba(250,204,21,0.04)' : 'transparent' }}>

      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
            style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
            <AvatarImg src={user.avatarUrl}
              className="h-full w-full object-cover"
              fallback={<span className="text-xs font-bold" style={{ color: '#0057b8' }}>{user.name[0]?.toUpperCase() ?? '?'}</span>} />
            {isImpersonating && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full"
                style={{ background: 'rgba(250,204,21,0.3)' }}>
                <Eye size={10} style={{ color: '#FACC15' }} />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-white" style={{ maxWidth: 180 }}>{user.name}</p>
              {isImpersonating && (
                <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                  style={{ background: 'rgba(250,204,21,0.15)', color: '#FACC15', border: '1px solid rgba(250,204,21,0.3)' }}>
                  <Eye size={7} />Viewing
                </span>
              )}
            </div>
            <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.4)', maxWidth: 200 }}>{user.email}</p>
          </div>
        </div>
      </td>

      <td className="px-4 py-3.5">
        <span className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-semibold"
          style={{ background: roleStyle.bg, color: roleStyle.color }}>
          {roleStyle.label}
        </span>
      </td>

      <td className="px-4 py-3.5">
        {catStyle
          ? <span className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-semibold"
              style={{ background: catStyle.bg, color: catStyle.color }}>
              {CATEGORY_LABELS[displayCat!]}
            </span>
          : <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>}
      </td>

      <td className="px-4 py-3.5">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={user.isActive
            ? { background: 'rgba(74,222,128,0.12)', color: '#4ADE80' }
            : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: user.isActive ? '#4ADE80' : 'rgba(255,255,255,0.3)' }} />
          {user.isActive ? 'active' : 'inactive'}
        </span>
      </td>

      <td className="px-4 py-3.5">
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{fmtDate(user.createdAt)}</span>
      </td>

      <td className="px-4 py-3.5">
        <AnimatePresence mode="wait">
          {!confirmDelete ? (
            <motion.div key="acts"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">

              <button onClick={onView}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.08]"
                style={{ color: 'rgba(255,255,255,0.5)' }} title="View profile">
                <Eye size={13} />
              </button>

              {canManage && (
                <>
                  <button onClick={onEdit}
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.08]"
                    style={{ color: 'rgba(255,255,255,0.5)' }} title="Edit user">
                    <Pencil size={13} />
                  </button>

                  <button onClick={() => setConfirmDelete(true)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-red-500/15"
                    style={{ color: 'rgba(248,113,113,0.7)' }} title="Delete user">
                    <Trash2 size={13} />
                  </button>
                </>
              )}

              {isSuperAdmin && (
                <button onClick={handleImpersonate} disabled={impersonate.isPending}
                  className="ml-1 flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-all hover:opacity-80 disabled:opacity-40"
                  style={isImpersonating
                    ? { background: 'rgba(250,204,21,0.15)', color: '#FACC15', border: '1px solid rgba(250,204,21,0.3)' }
                    : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.09)' }}
                  title="Impersonate user">
                  {impersonate.isPending ? <Spinner size={11} /> : <Eye size={11} />}
                  {isImpersonating ? 'Viewing' : 'Impersonate'}
                </button>
              )}
            </motion.div>
          ) : (
            <motion.div key="confirm"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex items-center justify-end gap-2">
              <span className="whitespace-nowrap text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Delete?</span>
              <button onClick={handleDelete} disabled={deleteUser.isPending}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.85)' }}>
                {deleteUser.isPending && <Spinner size={10} />}
                Yes, delete
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-white/[0.08]"
                style={{ color: 'rgba(255,255,255,0.5)' }}>
                Cancel
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </td>
    </motion.tr>
  )
}
