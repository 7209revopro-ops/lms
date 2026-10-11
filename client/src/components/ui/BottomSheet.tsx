'use client'
/* A sheet: a bottom drawer on a phone (with a grab handle), a centred popup
   from `sm` up. Escape and the backdrop close it. */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

export function BottomSheet({ children, onClose, label, wide }: { children: React.ReactNode; onClose: () => void; label: string; wide?: boolean }) {
  /* Rendered into <body>: inside an animated (transformed) parent, `fixed`
     would be fixed to that parent instead of the screen. */
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => setHost(document.body), [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev }
  }, [onClose])
  if (!host) return null
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={label}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, y: 48 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 48 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className={`relative flex max-h-[85dvh] w-full flex-col rounded-t-3xl bg-[var(--color-bg-surface)] sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
        style={{ boxShadow: '0 24px 64px rgba(15,23,42,0.22)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <span aria-hidden className="mx-auto mt-2.5 block h-1.5 w-10 flex-shrink-0 rounded-full sm:hidden" style={{ background: 'var(--color-border)' }} />
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 rounded-full p-2 hover:bg-[var(--color-bg-muted)]">
          <X size={16} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        {children}
      </motion.div>
    </div>,
    host,
  )
}
