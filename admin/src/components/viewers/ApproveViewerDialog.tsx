'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Check, ChevronDown, X } from 'lucide-react'
import type { AdminUser } from '@/lib/api/users'
import Spinner from '@/components/ui/Spinner'

type ProgramCategory = '4x-trading' | 'digital-marketing' | 'ai' | 'jura'

const ALL_CATEGORIES: ProgramCategory[] = ['4x-trading', 'digital-marketing', 'ai', 'jura']

const CATEGORY_META: Record<ProgramCategory, { label: string; color: string; bg: string }> = {
  '4x-trading':        { label: 'FOREX Trading',     color: '#10B981', bg: 'rgba(16,185,129,0.14)'  },
  'jura':              { label: 'JURA',              color: '#8B5CF6', bg: 'rgba(139,92,246,0.14)'  },
  'digital-marketing': { label: 'Digital Marketing', color: '#0057b8', bg: 'rgba(0,87,184,0.14)' },
  'ai':                { label: 'AI',                 color: '#8B5CF6', bg: 'rgba(139,92,246,0.14)'  },
}

interface Props {
  user:          AdminUser
  scopeCategory: ProgramCategory | null
  loading:       boolean
  onClose:       () => void
  onConfirm:     (cats: ProgramCategory[]) => void
}

export function ApproveViewerDialog({ user, scopeCategory, loading, onClose, onConfirm }: Props) {
  const [cats, setCats]   = useState<ProgramCategory[]>(scopeCategory ? [scopeCategory] : [])
  const [open, setOpen]   = useState(false)

  const toggle = (cat: ProgramCategory) => {
    setCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative w-full max-w-md rounded-2xl"
        style={{ background: 'linear-gradient(145deg,#0e1022,#0a0c18)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 40px 80px rgba(0,0,0,0.8)', zIndex: 1 }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#4ADE80' }}>Approve Viewer → Student</p>
            <h2 className="mt-0.5 text-base font-bold text-white">{user.name}</h2>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.email}</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.08]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Assign program category {scopeCategory ? '(locked to your role)' : '(select one or more)'}
            </label>

            {scopeCategory ? (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <span className="rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: CATEGORY_META[scopeCategory].bg, color: CATEGORY_META[scopeCategory].color }}>
                  {CATEGORY_META[scopeCategory].label}
                </span>
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>locked to your program</span>
              </div>
            ) : (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpen(v => !v)}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: `1px solid ${open ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.09)'}`,
                    color: 'white',
                  }}
                >
                  <span className="flex flex-wrap gap-1">
                    {cats.length === 0
                      ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>Select program(s)…</span>
                      : cats.map(c => (
                        <span key={c} className="rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: CATEGORY_META[c].bg, color: CATEGORY_META[c].color }}>
                          {CATEGORY_META[c].label}
                        </span>
                      ))}
                  </span>
                  <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.35)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
                </button>
                {open && (
                  <>
                    <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
                    <div className="absolute left-0 bottom-full z-[71] mb-1 w-full overflow-hidden rounded-xl py-1"
                      style={{ background: '#131525', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}>
                      {ALL_CATEGORIES.map(cat => {
                        const m = CATEGORY_META[cat]
                        const selected = cats.includes(cat)
                        return (
                          <button key={cat} type="button" onClick={() => toggle(cat)}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/[0.06]">
                            <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded"
                              style={{ background: selected ? m.bg : 'rgba(255,255,255,0.06)', border: `1px solid ${selected ? m.color : 'rgba(255,255,255,0.15)'}` }}>
                              {selected && <Check size={10} style={{ color: m.color }} />}
                            </div>
                            <span style={{ color: selected ? m.color : 'rgba(255,255,255,0.75)' }}>{m.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/[0.07]"
              style={{ color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </button>
            <button
              onClick={() => cats.length > 0 && onConfirm(cats)}
              disabled={loading || cats.length === 0}
              className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#4ADE80,#22c55e)', boxShadow: '0 4px 14px rgba(74,222,128,0.3)' }}>
              {loading && <Spinner size={13} />}
              <CheckCircle2 size={13} />
              Approve as Student
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
