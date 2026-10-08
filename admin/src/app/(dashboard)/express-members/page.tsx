'use client'

import { useState, useCallback, useRef } from 'react'
import { Zap, Search, Users, Shield, ShieldOff, Trash2, ChevronLeft, ChevronRight, Globe, X, AlertTriangle } from 'lucide-react'
import { useExpressMembers, useToggleExpressMember, useDeleteExpressMember, type ExpressMember, type ExpressMemberStatus } from '@/lib/api/expressMembers'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { CsTag } from '@/components/ui/CsTag'

/* ── Avatar initials helper ────────────────────── */
function Initials({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const letters = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = [
    'bg-violet-100 text-violet-700', 'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700',
  ]
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <AvatarImg src={avatarUrl} className="w-9 h-9 rounded-full object-cover"
      fallback={
        <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${color}`}>
          {letters}
        </span>
      } />
  )
}

/* ── Status badge ──────────────────────────────── */
function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      Blocked
    </span>
  )
}

/* ── Confirm-delete modal ──────────────────────── */
function DeleteModal({
  member,
  onConfirm,
  onCancel,
  loading,
}: {
  member: ExpressMember
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-center w-12 h-12 bg-red-50 rounded-full mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h3 className="text-center text-lg font-semibold text-gray-900 mb-1">Delete member?</h3>
        <p className="text-center text-sm text-gray-500 mb-6">
          <span className="font-medium text-gray-700">{member.name}</span>&apos;s account and all their data will be permanently removed.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Filter tabs ───────────────────────────────── */
const STATUS_TABS: { key: ExpressMemberStatus; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'active',  label: 'Active' },
  { key: 'blocked', label: 'Blocked' },
]

/* ── Main page ─────────────────────────────────── */
export default function ExpressMembersPage() {
  const [status, setStatus]       = useState<ExpressMemberStatus>('all')
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage]           = useState(1)
  const [toDelete, setToDelete]   = useState<ExpressMember | null>(null)
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data, isLoading } = useExpressMembers(status, debouncedSearch, page)
  const members  = data?.data ?? []
  const meta     = data?.meta
  const totalCount = meta?.total_count ?? 0
  const totalPages = meta?.total_pages ?? 1

  const toggleMutation = useToggleExpressMember()
  const deleteMutation = useDeleteExpressMember()

  const handleSearch = useCallback((val: string) => {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val)
      setPage(1)
    }, 350)
  }, [])

  const handleTabChange = (s: ExpressMemberStatus) => {
    setStatus(s)
    setPage(1)
  }

  const handleToggle = (id: string) => {
    toggleMutation.mutate(id)
  }

  const handleDeleteConfirm = () => {
    if (!toDelete) return
    deleteMutation.mutate(toDelete.id, {
      onSuccess: () => setToDelete(null),
    })
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gray-50/50">
      {toDelete && (
        <DeleteModal
          member={toDelete}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setToDelete(null)}
          loading={deleteMutation.isPending}
        />
      )}

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
            <Zap className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Express Members</h1>
            <p className="text-sm text-gray-500">Quick-signup accounts — email, name & country only</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-5">
        {/* ── Stats row ── */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total', value: totalCount, icon: Users, color: 'text-violet-600 bg-violet-50' },
            { label: 'Active', value: members.filter(m => m.isActive).length, icon: Shield, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Blocked', value: members.filter(m => !m.isActive).length, icon: ShieldOff, color: 'text-red-600 bg-red-50' },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-gray-500">{stat.label}</p>
                <p className="text-xl font-semibold text-gray-900 leading-none mt-0.5">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search name or email…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 placeholder-gray-400"
            />
            {search && (
              <button
                onClick={() => handleSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status tabs */}
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1 self-start sm:self-auto">
            {STATUS_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${
                  status === t.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <Users className="w-8 h-8 text-gray-300" />
              <p className="text-sm text-gray-400">
                {debouncedSearch ? 'No members match your search' : 'No express members yet'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Member</th>
                    <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Email</th>
                    <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Country</th>
                    <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Joined</th>
                    <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {members.map(member => (
                    <tr key={member.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Initials name={member.name} avatarUrl={member.avatarUrl} />
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-gray-800">{member.name}</span>
                            <div><CsTag cs={member.tetraCs} /></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-500">{member.email}</span>
                      </td>
                      <td className="px-4 py-3">
                        {member.country ? (
                          <div className="flex items-center gap-1.5 text-sm text-gray-600">
                            <Globe className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            {member.country}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-500">{formatDate(member.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge isActive={member.isActive} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleToggle(member.id)}
                            disabled={toggleMutation.isPending}
                            title={member.isActive ? 'Block member' : 'Unblock member'}
                            className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                              member.isActive
                                ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {member.isActive ? <ShieldOff className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => setToDelete(member)}
                            title="Delete member"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                {totalCount} member{totalCount !== 1 ? 's' : ''} total
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={!meta?.has_prev}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500 px-2">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={!meta?.has_next}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
