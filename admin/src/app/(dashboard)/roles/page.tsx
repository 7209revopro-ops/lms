'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Plus, Trash2, Edit2, Check, X,
  ChevronRight, Lock, Save, AlertCircle, Users as UsersIcon,
  GraduationCap, UserCog, Search, ChevronDown,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import {
  useRoles, useCreateRole, useUpdateRole, useUpdatePermissions,
  useDeleteRole, useAssignRole,
  PERMISSION_RESOURCES, type Role, type ResourcePermission, type PermissionResource,
} from '@/lib/api/roles'
import { useUsers, type AdminUser } from '@/lib/api/users'
import { useCurrentUser } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'
import { useRouter } from 'next/navigation'
import { AvatarImg } from '@/components/ui/AvatarImg'

/* ── Types ─────────────────────────────────────────────────────── */
type TabKey = 'roles' | 'users'

/* ── Permission matrix helpers ─────────────────────────────────── */

const ACTION_COLS: { key: keyof Omit<ResourcePermission, 'resource'>; label: string; tip: string }[] = [
  { key: 'read',        label: 'Read',        tip: 'View a single record' },
  { key: 'list',        label: 'List',        tip: 'See full details list' },
  { key: 'list_basic',  label: 'List (basic)', tip: 'Name + ID only' },
  { key: 'create',      label: 'Create',      tip: 'Create new records' },
  { key: 'update',      label: 'Update',      tip: 'Edit existing records' },
  { key: 'delete',      label: 'Delete',      tip: 'Remove records' },
  { key: 'impersonate', label: 'Impersonate', tip: 'Log in as this user (users resource only)' },
]

const RESOURCE_LABELS: Record<PermissionResource, string> = {
  'users':        'Users',
  'courses':      'Courses',
  'live-classes': 'Live Classes',
  'bookings':     'Bookings',
  'orders':       'Orders',
  'categories':   'Categories',
  'coupons':      'Coupons',
  'reviews':      'Reviews',
  'reports':      'Reports',
  'roles':        'Roles',
  'support':      'Support',
  'announcements':'Announcements',
}

function permissionsFromRole(role: Role): ResourcePermission[] {
  const map = new Map(role.permissions.map(p => [p.resource, p] as [string, ResourcePermission]))
  return PERMISSION_RESOURCES.map(r => {
    const p = map.get(r)
    return {
      resource: r, create: p?.create ?? false, read: p?.read ?? false,
      update: p?.update ?? false, delete: p?.delete ?? false,
      list: p?.list ?? false, list_basic: p?.list_basic ?? false,
      impersonate: r === 'users' ? (p?.impersonate ?? false) : false,
    }
  })
}

/* ── Permission Matrix component ───────────────────────────────── */

interface MatrixProps {
  permissions: ResourcePermission[]
  onChange:    (perms: ResourcePermission[]) => void
  readOnly:    boolean
}

function PermissionMatrix({ permissions, onChange, readOnly }: MatrixProps) {
  const toggle = (resource: PermissionResource, action: keyof Omit<ResourcePermission, 'resource'>) => {
    if (readOnly) return
    if (action === 'impersonate' && resource !== 'users') return
    onChange(permissions.map(p => p.resource === resource ? { ...p, [action]: !p[action] } : p))
  }

  const toggleRow = (resource: PermissionResource, all: boolean) => {
    if (readOnly) return
    onChange(permissions.map(p => {
      if (p.resource !== resource) return p
      const next: ResourcePermission = { ...p }
      for (const col of ACTION_COLS) {
        if (col.key === 'impersonate' && resource !== 'users') continue
        next[col.key] = all
      }
      return next
    }))
  }

  const toggleCol = (action: keyof Omit<ResourcePermission, 'resource'>, all: boolean) => {
    if (readOnly) return
    onChange(permissions.map(p => {
      if (action === 'impersonate' && p.resource !== 'users') return p
      return { ...p, [action]: all }
    }))
  }

  const rowFull = (resource: PermissionResource) =>
    ACTION_COLS.filter(c => !(c.key === 'impersonate' && resource !== 'users'))
      .every(c => permissions.find(p => p.resource === resource)?.[c.key])

  const colFull = (action: keyof Omit<ResourcePermission, 'resource'>) =>
    PERMISSION_RESOURCES.filter(r => !(action === 'impersonate' && r !== 'users'))
      .every(r => permissions.find(p => p.resource === r)?.[action])

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-32 py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              Resource
            </th>
            {ACTION_COLS.map(col => (
              <th key={col.key} className="min-w-[76px] px-2 py-2 text-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'rgba(255,255,255,0.4)' }} title={col.tip}>
                    {col.label}
                  </span>
                  {!readOnly && (
                    <button onClick={() => toggleCol(col.key, !colFull(col.key))}
                      className="flex h-5 w-5 items-center justify-center rounded transition-colors"
                      style={{
                        background: colFull(col.key) ? 'rgba(0,87,184,0.2)' : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${colFull(col.key) ? 'rgba(0,87,184,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      }}
                      title={`Toggle all ${col.label}`}>
                      <Check size={10} style={{ color: colFull(col.key) ? '#0057b8' : 'rgba(255,255,255,0.2)' }} />
                    </button>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_RESOURCES.map((resource, ri) => {
            const row = permissions.find(p => p.resource === resource)
            if (!row) return null
            return (
              <tr key={resource}
                style={{ background: ri % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
                className="group">
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    {!readOnly && (
                      <button onClick={() => toggleRow(resource, !rowFull(resource))}
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors"
                        style={{
                          background: rowFull(resource) ? 'rgba(0,87,184,0.2)' : 'rgba(255,255,255,0.06)',
                          border: `1px solid ${rowFull(resource) ? 'rgba(0,87,184,0.5)' : 'rgba(255,255,255,0.1)'}`,
                        }}
                        title="Toggle all for this resource">
                        <Check size={10} style={{ color: rowFull(resource) ? '#0057b8' : 'rgba(255,255,255,0.2)' }} />
                      </button>
                    )}
                    <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
                      {RESOURCE_LABELS[resource]}
                    </span>
                  </div>
                </td>
                {ACTION_COLS.map(col => {
                  const disabled = col.key === 'impersonate' && resource !== 'users'
                  const checked  = !disabled && !!row[col.key]
                  return (
                    <td key={col.key} className="px-2 py-2 text-center">
                      {disabled ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded"
                          style={{ background: 'rgba(255,255,255,0.03)' }}>
                          <span className="h-[2px] w-3 rounded" style={{ background: 'rgba(255,255,255,0.1)' }} />
                        </span>
                      ) : (
                        <button onClick={() => toggle(resource, col.key)} disabled={readOnly}
                          className="inline-flex h-6 w-6 items-center justify-center rounded transition-all"
                          style={{
                            background: checked ? 'rgba(0,87,184,0.18)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${checked ? 'rgba(0,87,184,0.45)' : 'rgba(255,255,255,0.1)'}`,
                            cursor: readOnly ? 'default' : 'pointer',
                          }}>
                          <Check size={11}
                            style={{ color: checked ? '#0057b8' : 'rgba(255,255,255,0.15)', opacity: checked ? 1 : 0.4 }} />
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── Role list item ─────────────────────────────────────────────── */

interface RoleItemProps {
  role:       Role
  selected:   boolean
  onSelect:   () => void
  onDelete:   () => void
  isDeleting: boolean
}

function RoleItem({ role, selected, onSelect, onDelete, isDeleting }: RoleItemProps) {
  return (
    <div onClick={onSelect}
      className="group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-all"
      style={{
        background: selected ? 'rgba(0,87,184,0.10)' : 'rgba(255,255,255,0.025)',
        border: `1px solid ${selected ? 'rgba(0,87,184,0.30)' : 'rgba(255,255,255,0.07)'}`,
      }}>
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ background: selected ? 'rgba(0,87,184,0.18)' : 'rgba(255,255,255,0.05)' }}>
        {role.isSystem
          ? <Lock size={14} style={{ color: selected ? '#0057b8' : 'rgba(255,255,255,0.4)' }} />
          : <ShieldCheck size={14} style={{ color: selected ? '#0057b8' : 'rgba(255,255,255,0.4)' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color: selected ? '#fff' : 'rgba(255,255,255,0.75)' }}>
          {role.name}
        </p>
        {role.description && (
          <p className="truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{role.description}</p>
        )}
        {role.isSystem && (
          <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{ background: 'rgba(99,102,241,0.15)', color: '#818CF8' }}>System</span>
        )}
      </div>
      {!role.isSystem && (
        <button onClick={e => { e.stopPropagation(); onDelete() }} disabled={isDeleting}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-lg transition-all hover:bg-red-500/20"
          style={{ color: 'rgba(255,80,80,0.7)' }} title="Delete role">
          {isDeleting ? <Spinner size={12} /> : <Trash2 size={12} />}
        </button>
      )}
      <ChevronRight size={13} className="flex-shrink-0 transition-transform group-hover:translate-x-0.5"
        style={{ color: selected ? '#0057b8' : 'rgba(255,255,255,0.2)' }} />
    </div>
  )
}

/* ── Role select dropdown ───────────────────────────────────────── */

interface RoleSelectProps {
  userId:      string
  currentId:   string | null
  roles:       Role[]
  disabled?:   boolean
}

function RoleSelect({ userId, currentId, roles, disabled }: RoleSelectProps) {
  const assignMutation = useAssignRole()
  const [open, setOpen] = useState(false)

  const currentRole = roles.find(r => r.id === currentId)

  const assign = async (roleId: string | null) => {
    setOpen(false)
    await assignMutation.mutateAsync({ userId, roleId })
  }

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled || assignMutation.isPending}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-all disabled:opacity-50"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: currentRole ? '#fff' : 'rgba(255,255,255,0.35)',
          minWidth: 130,
        }}>
        {assignMutation.isPending
          ? <Spinner size={11} />
          : <ShieldCheck size={11} style={{ color: currentRole ? '#0057b8' : 'rgba(255,255,255,0.2)' }} />}
        <span className="flex-1 text-left truncate">
          {assignMutation.isPending ? 'Saving…' : (currentRole?.name ?? 'No custom role')}
        </span>
        {!assignMutation.isPending && <ChevronDown size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl py-1"
              style={{ background: '#1A1D2E', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
              {/* No role option */}
              <button onClick={() => assign(null)}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-white/5"
                style={{ color: currentId == null ? '#0057b8' : 'rgba(255,255,255,0.5)' }}>
                <X size={11} />
                <span>No custom role</span>
                {currentId == null && <Check size={11} className="ml-auto" />}
              </button>
              {/* Divider */}
              <div className="mx-3 my-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
              {roles.map(role => (
                <button key={role.id} onClick={() => assign(role.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-white/5"
                  style={{ color: currentId === role.id ? '#0057b8' : 'rgba(255,255,255,0.7)' }}>
                  {role.isSystem
                    ? <Lock size={11} style={{ flexShrink: 0, color: 'rgba(255,255,255,0.3)' }} />
                    : <ShieldCheck size={11} style={{ flexShrink: 0, color: 'rgba(255,255,255,0.3)' }} />}
                  <span className="flex-1 truncate text-left">{role.name}</span>
                  {currentId === role.id && <Check size={11} />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Users tab ──────────────────────────────────────────────────── */

function UsersTab({ roles }: { roles: Role[] }) {
  const [search, setSearch]       = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'instructor' | 'admin'>('all')

  const { data: instructors, isLoading: loadInst } = useUsers('instructor', { per_page: 100 })
  const { data: admins,      isLoading: loadAdmin } = useUsers('admin',      { per_page: 100 })

  const loading = loadInst || loadAdmin

  const allUsers: AdminUser[] = [
    ...(admins?.docs      ?? []),
    ...(instructors?.docs ?? []),
  ]

  const filtered = allUsers.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    }
    return true
  })

  const roleBadge = (role: string) => {
    if (role === 'admin')      return { label: 'Admin',      color: '#818CF8', bg: 'rgba(99,102,241,0.12)' }
    if (role === 'instructor') return { label: 'Instructor', color: '#34D399', bg: 'rgba(52,211,153,0.10)' }
    return                            { label: role,         color: '#94A3B8', bg: 'rgba(148,163,184,0.10)' }
  }

  const getUserCustomRoleId = (u: AdminUser): string | null => {
    if (!u.customRoleId) return null
    if (typeof u.customRoleId === 'string') return u.customRoleId
    return u.customRoleId.id
  }

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'rgba(255,255,255,0.25)' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-xl py-2 pl-8 pr-3 text-sm text-white placeholder-white/25 focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
        </div>

        <div className="flex gap-1.5">
          {(['all', 'instructor', 'admin'] as const).map(v => (
            <button key={v} onClick={() => setRoleFilter(v)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors"
              style={{
                background: roleFilter === v ? 'rgba(0,87,184,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${roleFilter === v ? 'rgba(0,87,184,0.35)' : 'rgba(255,255,255,0.08)'}`,
                color: roleFilter === v ? '#0057b8' : 'rgba(255,255,255,0.5)',
              }}>
              {v === 'all' ? 'All' : v === 'instructor' ? 'Instructors' : 'Admins'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={22} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <UsersIcon size={28} style={{ color: 'rgba(255,255,255,0.1)' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No users found</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5"
            style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>User</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider w-20 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>Base role</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider w-[150px] text-left" style={{ color: 'rgba(255,255,255,0.3)' }}>Custom role</p>
          </div>

          {filtered.map((user, i) => {
            const badge    = roleBadge(user.role)
            const customId = getUserCustomRoleId(user)
            const initial  = (user.name ?? '?').charAt(0).toUpperCase()

            return (
              <div key={user.id}
                className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-4 py-3 transition-colors hover:bg-white/[0.02]"
                style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                {/* User info */}
                <div className="flex items-center gap-3 min-w-0">
                  <AvatarImg src={user.avatarUrl}
                    className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
                    fallback={(
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #0057b840, #003d8040)', border: '1px solid rgba(0,87,184,0.3)' }}>
                      {initial}
                    </div>
                  )} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{user.name}</p>
                    <p className="truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{user.email}</p>
                  </div>
                </div>

                {/* Base role badge */}
                <div className="w-20 flex justify-center">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                    style={{ background: badge.bg, color: badge.color }}>
                    {user.role === 'instructor' ? <GraduationCap size={9} /> : <UserCog size={9} />}
                    {badge.label}
                  </span>
                </div>

                {/* Custom role assign */}
                <div className="w-[150px] flex justify-start">
                  <RoleSelect
                    userId={user.id}
                    currentId={customId}
                    roles={roles}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────────── */

export default function RolesPage() {
  const router = useRouter()
  const { data: currentUser, isLoading: userLoading } = useCurrentUser()

  useEffect(() => {
    if (!userLoading && currentUser && currentUser.role !== 'super_admin') {
      router.replace('/')
    }
  }, [userLoading, currentUser, router])

  const { data: roles = [], isLoading } = useRoles()
  const createMutation  = useCreateRole()
  const updateMutation  = useUpdateRole()
  const permsMutation   = useUpdatePermissions()
  const deleteMutation  = useDeleteRole()

  /* Tab state */
  const [tab, setTab] = useState<TabKey>('roles')

  /* Selected role */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedRole = roles.find(r => r.id === selectedId) ?? null

  /* Auto-select first role when list loads */
  useEffect(() => {
    if (!selectedId && roles.length > 0) setSelectedId(roles[0].id)
  }, [roles, selectedId])

  /* Matrix draft */
  const [draft, setDraft]           = useState<ResourcePermission[]>([])
  const [draftDirty, setDraftDirty] = useState(false)

  useEffect(() => {
    if (selectedRole) { setDraft(permissionsFromRole(selectedRole)); setDraftDirty(false) }
  }, [selectedRole?.id])

  /* Edit role name/description inline */
  const [editingRole, setEditingRole] = useState(false)
  const [editName, setEditName]       = useState('')
  const [editDesc, setEditDesc]       = useState('')

  /* Create form */
  const [showCreate, setShowCreate]  = useState(false)
  const [createName, setCreateName]  = useState('')
  const [createDesc, setCreateDesc]  = useState('')
  const [createErr,  setCreateErr]   = useState<string | null>(null)

  /* Permissions save */
  const [saveOk,  setSaveOk]         = useState(false)
  const [saveErr, setSaveErr]        = useState<string | null>(null)
  const [deletingId, setDeletingId]  = useState<string | null>(null)

  /* ── Handlers ── */

  const handleSavePermissions = async () => {
    if (!selectedRole) return
    setSaveErr(null)
    try {
      await permsMutation.mutateAsync({ id: selectedRole.id, permissions: draft })
      setDraftDirty(false)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2500)
    } catch (err: any) {
      setSaveErr(err?.response?.data?.error?.message ?? 'Failed to save permissions.')
    }
  }

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRole) return
    try {
      await updateMutation.mutateAsync({ id: selectedRole.id, name: editName.trim(), description: editDesc.trim() || undefined })
      setEditingRole(false)
    } catch { /* ignored */ }
  }

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateErr(null)
    try {
      const created = await createMutation.mutateAsync({ name: createName.trim(), description: createDesc.trim() || undefined })
      setSelectedId(created.id)
      setCreateName(''); setCreateDesc(''); setShowCreate(false)
    } catch (err: any) {
      setCreateErr(err?.response?.data?.error?.message ?? 'Could not create role.')
    }
  }

  const handleDelete = async (role: Role) => {
    if (role.isSystem) return
    if (!confirm(`Delete role "${role.name}"? Users with this role will have it removed.`)) return
    setDeletingId(role.id)
    try {
      await deleteMutation.mutateAsync(role.id)
      if (selectedId === role.id) setSelectedId(roles.find(r => r.id !== role.id)?.id ?? null)
    } finally { setDeletingId(null) }
  }

  /* ── Render ── */

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Define what each role can do across every resource"
        badge={{ label: 'Admin', color: '#818CF8' }}
        actions={
          tab === 'roles' && (
            <button onClick={() => setShowCreate(v => !v)}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 16px rgba(0,87,184,0.28)' }}>
              <Plus size={14} />{showCreate ? 'Cancel' : 'New role'}
            </button>
          )
        }
      />

      {/* ── Tab bar ── */}
      <div className="mb-5 flex gap-1"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 0 }}>
        {([
          { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
          { key: 'users', label: 'User Assignments',    icon: UsersIcon },
        ] as { key: TabKey; label: string; icon: React.ElementType }[]).map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors"
              style={{ color: active ? '#0057b8' : 'rgba(255,255,255,0.4)' }}>
              <Icon size={14} />
              {t.label}
              {active && (
                <motion.span layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full"
                  style={{ background: '#0057b8' }} />
              )}
            </button>
          )
        })}
      </div>

      {/* ── Create form (Roles tab only) ── */}
      <AnimatePresence>
        {tab === 'roles' && showCreate && (
          <motion.form onSubmit={submitCreate}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mb-5 overflow-hidden">
            <div className="rounded-2xl p-5 space-y-4"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-sm font-semibold text-white">Create new role</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
                <input value={createName} onChange={e => setCreateName(e.target.value)}
                  placeholder="Role name *" required
                  className="rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
                <input value={createDesc} onChange={e => setCreateDesc(e.target.value)}
                  placeholder="Description (optional)"
                  className="rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
              </div>
              {createErr && (
                <p className="flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
                  <AlertCircle size={12} />{createErr}
                </p>
              )}
              <button type="submit" disabled={createMutation.isPending}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
                {createMutation.isPending ? <Spinner size={13} /> : <Plus size={13} />}
                Create role
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* ── Tab content ── */}
      {tab === 'users' ? (
        <UsersTab roles={roles} />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size={24} />
        </div>
      ) : (
        <div className="flex gap-5 items-start">

          {/* ── Left: role list ── */}
          <div className="flex w-64 flex-shrink-0 flex-col gap-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.15em]"
              style={{ color: 'rgba(255,255,255,0.25)' }}>Roles ({roles.length})</p>
            {roles.map(role => (
              <RoleItem
                key={role.id}
                role={role}
                selected={role.id === selectedId}
                onSelect={() => setSelectedId(role.id)}
                onDelete={() => handleDelete(role)}
                isDeleting={deletingId === role.id}
              />
            ))}
          </div>

          {/* ── Right: matrix panel ── */}
          <div className="min-w-0 flex-1 rounded-2xl p-5"
            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>

            {!selectedRole ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <ShieldCheck size={32} style={{ color: 'rgba(255,255,255,0.1)' }} />
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Select a role to edit its permissions</p>
              </div>
            ) : (
              <>
                {/* Role header */}
                <div className="mb-5 flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                    style={{ background: 'rgba(0,87,184,0.12)', border: '1px solid rgba(0,87,184,0.2)' }}>
                    {selectedRole.isSystem
                      ? <Lock size={16} style={{ color: '#0057b8' }} />
                      : <ShieldCheck size={16} style={{ color: '#0057b8' }} />}
                  </div>

                  {editingRole ? (
                    <form onSubmit={submitEdit} className="flex flex-1 flex-col gap-2">
                      <div className="flex gap-2">
                        <input value={editName} onChange={e => setEditName(e.target.value)}
                          placeholder="Role name" required autoFocus
                          className="flex-1 rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none"
                          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }} />
                        <button type="submit" disabled={updateMutation.isPending}
                          className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-white/10 disabled:opacity-50"
                          style={{ color: '#4ADE80' }}>
                          {updateMutation.isPending ? <Spinner size={14} /> : <Check size={14} />}
                        </button>
                        <button type="button" onClick={() => setEditingRole(false)}
                          className="flex h-8 w-8 items-center justify-center rounded-xl hover:bg-white/10"
                          style={{ color: 'rgba(255,255,255,0.4)' }}>
                          <X size={14} />
                        </button>
                      </div>
                      <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
                        placeholder="Description (optional)"
                        className="rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }} />
                    </form>
                  ) : (
                    <div className="flex flex-1 items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-semibold text-white">{selectedRole.name}</h2>
                          {selectedRole.isSystem && (
                            <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                              style={{ background: 'rgba(99,102,241,0.15)', color: '#818CF8' }}>System</span>
                          )}
                        </div>
                        {selectedRole.description && (
                          <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                            {selectedRole.description}
                          </p>
                        )}
                      </div>
                      {!selectedRole.isSystem && (
                        <button onClick={() => { setEditName(selectedRole.name); setEditDesc(selectedRole.description ?? ''); setEditingRole(true) }}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-white/10"
                          style={{ color: 'rgba(255,255,255,0.5)' }}>
                          <Edit2 size={11} /> Edit name
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Matrix */}
                <div className="mb-5">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'rgba(255,255,255,0.3)' }}>Permission matrix</p>
                    {selectedRole.name === 'Super Admin' && (
                      <span className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                        <Lock size={10} /> Super Admin always has full access
                      </span>
                    )}
                  </div>
                  <PermissionMatrix
                    permissions={draft}
                    onChange={p => { setDraft(p); setDraftDirty(true); setSaveOk(false); setSaveErr(null) }}
                    readOnly={selectedRole.name === 'Super Admin'}
                  />
                </div>

                {/* Save bar — editable for every role except the unrestricted Super Admin */}
                {selectedRole.name !== 'Super Admin' && (
                  <div className="flex items-center gap-3">
                    <button onClick={handleSavePermissions}
                      disabled={!draftDirty || permsMutation.isPending}
                      className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{
                        background: draftDirty ? 'linear-gradient(135deg, #0057b8, #003d80)' : 'rgba(255,255,255,0.08)',
                        boxShadow: draftDirty ? '0 4px 16px rgba(0,87,184,0.28)' : 'none',
                      }}>
                      {permsMutation.isPending ? <Spinner size={14} />
                        : saveOk ? <Check size={14} /> : <Save size={14} />}
                      {saveOk ? 'Saved!' : 'Save permissions'}
                    </button>
                    {draftDirty && (
                      <button onClick={() => { setDraft(permissionsFromRole(selectedRole)); setDraftDirty(false) }}
                        className="text-xs transition-colors hover:text-white"
                        style={{ color: 'rgba(255,255,255,0.35)' }}>
                        Discard changes
                      </button>
                    )}
                    {saveErr && (
                      <p className="flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
                        <AlertCircle size={11} />{saveErr}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
