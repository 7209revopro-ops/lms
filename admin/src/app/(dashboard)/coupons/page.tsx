'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Tag, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, X, Check } from 'lucide-react'
import { useAdminCoupons, type AdminCoupon } from '@/lib/api/stats'
import { api } from '@/lib/axios'
import { useQueryClient } from '@tanstack/react-query'
import Spinner from '@/components/ui/Spinner'
import { useToast } from '@/store/ui.store'

/* ─── Create / Edit form ──────────────────────────── */
interface CouponFormState {
  code:          string
  discountType:  'percent' | 'fixed'
  discountValue: string
  maxUses:       string
  expiresAt:     string
}

const EMPTY_FORM: CouponFormState = {
  code:          '',
  discountType:  'percent',
  discountValue: '',
  maxUses:       '0',
  expiresAt:     '',
}

function CouponFormModal({
  initial,
  onClose,
}: {
  initial?: AdminCoupon
  onClose: () => void
}) {
  const qc     = useQueryClient()
  const [form, setForm] = useState<CouponFormState>(
    initial
      ? {
          code:          initial.code,
          discountType:  initial.discountType,
          discountValue: String(initial.discountValue),
          maxUses:       String(initial.maxUses),
          expiresAt:     initial.expiresAt ? initial.expiresAt.slice(0, 10) : '',
        }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        code:          form.code.toUpperCase().trim(),
        discountType:  form.discountType,
        discountValue: Number(form.discountValue),
        maxUses:       Number(form.maxUses),
        expiresAt:     form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      }
      if (initial) {
        await api.patch(`/admin/coupons/${initial.id}`, payload)
      } else {
        await api.post('/admin/coupons', payload)
      }
      qc.invalidateQueries({ queryKey: ['admin', 'coupons'] })
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, node: React.ReactNode) => (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
      {node}
    </label>
  )

  const inputCls = "w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none"
  /* colorScheme: 'dark' — this style dresses a native <select> and a native
     type="date"; without it both open light-mode chrome inside a dark modal
     and the date field's picker glyph is drawn dark-on-dark. */
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', colorScheme: 'dark' as const }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-2xl p-6 space-y-5"
        style={{ background: '#1A1D2E', border: '1px solid rgba(255,255,255,0.1)' }}>

        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">{initial ? 'Edit coupon' : 'New coupon'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10">
            <X size={16} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        {field('Code', (
          <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="SUMMER20" className={inputCls} style={inputStyle} disabled={!!initial} />
        ))}

        <div className="grid grid-cols-2 gap-3">
          {field('Type', (
            <select value={form.discountType}
              onChange={e => setForm(f => ({ ...f, discountType: e.target.value as 'percent' | 'fixed' }))}
              className={inputCls} style={inputStyle}>
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed amount</option>
            </select>
          ))}
          {/* A fixed amount is in the ACADEMY's currency, not USD (N-01). Say so
              on the label, because the number is otherwise ambiguous and the
              old "$" was wrong for every gateway actually in use. */}
          {field(
            form.discountType === 'fixed' && initial?.currency
              ? `Value (${initial.currency})`
              : 'Value',
            (
              <input type="number" value={form.discountValue}
                onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))}
                placeholder={form.discountType === 'percent' ? '20' : '100'}
                className={inputCls} style={inputStyle} min={0} />
            ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {field('Max uses (0=unlimited)', (
            <input type="number" value={form.maxUses}
              onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
              className={inputCls} style={inputStyle} min={0} />
          ))}
          {field('Expires (optional)', (
            <input type="date" value={form.expiresAt}
              onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
              className={inputCls} style={inputStyle} />
          ))}
        </div>

        {error && <p className="text-xs" style={{ color: '#F87171' }}>{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/[0.08]"
            style={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
            {saving ? <Spinner size={13} /> : <Check size={13} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/* ─── Page ────────────────────────────────────────── */
export default function AdminCouponsPage() {
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<'create' | AdminCoupon | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useAdminCoupons(page)
  const toast = useToast()

  /* `catch {}` ate the failure. An admin killing a coupon that is being
     abused clicked the Active badge, saw nothing change, and had no way to
     know the code was still live - the one case where silence is expensive. */
  const handleToggle = async (coupon: AdminCoupon) => {
    try {
      await api.patch(`/admin/coupons/${coupon.id}`, { isActive: !coupon.isActive })
      qc.invalidateQueries({ queryKey: ['admin', 'coupons'] })
    } catch {
      toast.error(
        coupon.isActive ? 'Could not deactivate the coupon' : 'Could not activate the coupon',
        `${coupon.code} is unchanged and still ${coupon.isActive ? 'live' : 'inactive'}.`,
      )
    }
  }

  const handleDelete = async (coupon: AdminCoupon) => {
    if (!confirm(`Delete coupon "${coupon.code}"? This cannot be undone.`)) return
    setDeleting(coupon.id)
    try {
      await api.delete(`/admin/coupons/${coupon.id}`)
      qc.invalidateQueries({ queryKey: ['admin', 'coupons'] })
    } catch (err: any) {
      alert(err?.response?.data?.error?.message ?? 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Coupons
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Create and manage promotional discount codes.
          </p>
        </div>
        <button onClick={() => setModal('create')}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
          <Plus size={14} />New coupon
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['Code', 'Discount', 'Uses', 'Expires', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold"
                  style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="py-16 text-center">
                <Spinner size={18} variant="muted" />
              </td></tr>
            ) : !data?.coupons.length ? (
              <tr><td colSpan={6} className="py-16 text-center text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
                No coupons yet. Create one to get started.
              </td></tr>
            ) : data.coupons.map((c, i) => (
              <motion.tr key={c.id}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td className="px-4 py-3">
                  <span className="font-mono font-bold text-white">{c.code}</span>
                </td>
                <td className="px-4 py-3 text-white font-semibold">
                  {/* Fixed amounts are in the owning academy's currency, not USD (N-01).
                      A coupon with no currency on record is refused at checkout, so
                      flag it here rather than rendering a misleading figure. */}
                  {c.discountType === 'percent'
                    ? `${c.discountValue}%`
                    : c.currency
                      ? `${c.currency} ${c.discountValue}`
                      : `${c.discountValue} ⚠️`}
                </td>
                <td className="px-4 py-3 tabular-nums" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {c.usedCount}{c.maxUses > 0 ? ` / ${c.maxUses}` : ''}
                </td>
                <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {c.expiresAt
                    ? new Date(c.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Never'}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => handleToggle(c)}
                    className="rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors"
                    style={{
                      background: c.isActive ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)',
                      color:      c.isActive ? '#4ADE80' : 'rgba(255,255,255,0.4)',
                    }}>
                    {c.isActive ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setModal(c)}
                      className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08]">
                      <Pencil size={12} style={{ color: 'rgba(255,255,255,0.5)' }} />
                    </button>
                    <button onClick={() => handleDelete(c)}
                      disabled={deleting === c.id}
                      className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] disabled:opacity-40">
                      {deleting === c.id
                        ? <Spinner size={12} />
                        : <Trash2 size={12} style={{ color: '#F87171' }} />}
                    </button>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>

        {data?.meta && data.meta.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Page {data.meta.page} of {data.meta.total_pages}
            </p>
            <div className="flex gap-1">
              <button disabled={!data.meta.has_prev} onClick={() => setPage(p => p - 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 hover:bg-white/[0.05]">
                <ChevronLeft size={14} style={{ color: 'white' }} />
              </button>
              <button disabled={!data.meta.has_next} onClick={() => setPage(p => p + 1)}
                className="rounded-lg p-1.5 disabled:opacity-30 hover:bg-white/[0.05]">
                <ChevronRight size={14} style={{ color: 'white' }} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {modal !== null && (
          <CouponFormModal
            initial={modal === 'create' ? undefined : modal}
            onClose={() => setModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
