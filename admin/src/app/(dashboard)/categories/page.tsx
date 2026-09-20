'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Check, X, AlertCircle, Tag } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import {
  useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory,
  type Category,
} from '@/lib/api/categories'
import Spinner from '@/components/ui/Spinner'

export default function CategoriesPage() {
  const { data: categories, isLoading } = useCategories()
  const createMutation = useCreateCategory()
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    try {
      await createMutation.mutateAsync({
        name:        createName.trim(),
        description: createDesc.trim() || undefined,
      })
      setCreateName('')
      setCreateDesc('')
      setShowCreate(false)
    } catch (err: any) {
      setCreateError(err?.response?.data?.error?.message ?? 'Unable to save category.')
    }
  }

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Organize courses into discoverable groups"
        badge={{ label: 'Catalog', color: '#4ADE80' }}
        actions={
          <button onClick={() => setShowCreate(v => !v)}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)', boxShadow: '0 4px 16px rgba(0,87,184,0.30)' }}>
            <Plus size={14} />{showCreate ? 'Cancel' : 'New category'}
          </button>
        } />

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.form onSubmit={submitCreate}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mb-5 overflow-hidden">
            <div className="rounded-2xl p-5 space-y-4"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
                <input value={createName} onChange={e => setCreateName(e.target.value)}
                  placeholder="Name (e.g. Marketing)" required minLength={2} maxLength={100}
                  className="rounded-xl px-3 py-2 text-sm text-white outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }} />
                <input value={createDesc} onChange={e => setCreateDesc(e.target.value)}
                  placeholder="Short description (optional)"
                  className="rounded-xl px-3 py-2 text-sm text-white outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }} />
              </div>
              {createError && (
                <p className="flex items-center gap-1.5 text-xs" style={{ color: '#F87171' }}>
                  <AlertCircle size={11} />{createError}
                </p>
              )}
              <div className="flex items-center justify-end">
                <button type="submit" disabled={createMutation.isPending}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #4ADE80, #22C55E)' }}>
                  {createMutation.isPending ? <><Spinner size={13} />Saving…</> : <><Check size={13} />Create</>}
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <Spinner size={14} />Loading…
        </div>
      )}

      {!isLoading && categories?.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <Tag size={20} style={{ color: 'rgba(255,255,255,0.2)' }} />
          </div>
          <p>No categories yet — create your first one.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories?.map((c, i) => (
          <CategoryCard key={c.id} category={c} index={i} editing={editingId === c.id} setEditingId={setEditingId} />
        ))}
      </div>
    </div>
  )
}

function CategoryCard({ category, index, editing, setEditingId }: {
  category: Category; index: number; editing: boolean; setEditingId: (id: string | null) => void
}) {
  const updateMutation = useUpdateCategory()
  const deleteMutation = useDeleteCategory()
  const [name, setName] = useState(category.name)
  const [desc, setDesc] = useState(category.description ?? '')
  const [err, setErr]   = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    setErr(null)
    try {
      await updateMutation.mutateAsync({ id: category.id, data: { name: name.trim(), description: desc.trim() || undefined } })
      setEditingId(null)
    } catch (e: any) {
      setErr(e?.response?.data?.error?.message ?? 'Unable to save.')
    }
  }

  const remove = async () => {
    try {
      await deleteMutation.mutateAsync(category.id)
    } catch (e: any) {
      setErr(e?.response?.data?.error?.message ?? 'Unable to delete.')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}
      className="rounded-2xl p-4"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>

      {editing ? (
        <div className="space-y-2.5">
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full rounded-lg px-2.5 py-1.5 text-sm text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }} />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
            placeholder="Description"
            className="w-full rounded-lg px-2.5 py-1.5 text-xs text-white outline-none resize-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }} />
          {err && <p className="flex items-center gap-1 text-[11px]" style={{ color: '#F87171' }}><AlertCircle size={10} />{err}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={() => { setEditingId(null); setName(category.name); setDesc(category.description ?? '') }}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-white/[0.08]"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </button>
            <button onClick={save} disabled={updateMutation.isPending}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
              {updateMutation.isPending ? <Spinner size={11} /> : <Check size={11} />}Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{category.name}</p>
              <p className="mt-0.5 truncate text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
                /{category.slug}
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setEditingId(category.id)}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.5)' }} title="Edit">
                <Edit2 size={12} />
              </button>
              <button onClick={() => setConfirmDelete(true)}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-red-500/15"
                style={{ color: 'rgba(255,255,255,0.5)' }} title="Delete">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          {category.description && (
            <p className="mt-2 line-clamp-2 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {category.description}
            </p>
          )}

          <AnimatePresence>
            {confirmDelete && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="mt-3 overflow-hidden">
                <div className="rounded-lg p-2.5"
                  style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)' }}>
                  <p className="text-xs" style={{ color: '#FCA5A5' }}>
                    Delete <span className="font-semibold">{category.name}</span>?
                  </p>
                  {err && <p className="mt-1 text-[11px]" style={{ color: '#F87171' }}>{err}</p>}
                  <div className="mt-2 flex items-center justify-end gap-1.5">
                    <button onClick={() => { setConfirmDelete(false); setErr(null) }}
                      className="rounded px-2 py-0.5 text-[11px] font-semibold"
                      style={{ color: 'rgba(255,255,255,0.6)' }}>Cancel</button>
                    <button onClick={remove} disabled={deleteMutation.isPending}
                      className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-60"
                      style={{ background: '#EF4444' }}>
                      {deleteMutation.isPending ? <Spinner size={9} /> : <X size={9} />}Delete
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  )
}
