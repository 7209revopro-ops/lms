'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'
import { useUIStore, type ToastKind } from '@/store/ui.store'
import { Button } from '@/components/ui/button'

const STYLES: Record<ToastKind, { fg: string; bg: string; border: string; Icon: React.ElementType }> = {
  success: { fg: '#059669', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.20)', Icon: CheckCircle2 },
  error:   { fg: '#DC2626', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.20)',  Icon: XCircle      },
  info:    { fg: '#2563EB', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.20)', Icon: Info          },
}

export function Toaster() {
  const toasts   = useUIStore(s => s.toasts)
  const popToast = useUIStore(s => s.popToast)

  /* `w-full` on a FIXED element resolves against the viewport, not against the
     space left of right-6 - so at 375px this was a 375px box pushed 24px right,
     and every toast in the app hung 24px off the LEFT edge with its status icon
     sliced off. max-w-sm (384px) never clamped it. Below `sm` both edges are
     pinned instead and the width follows; from `sm` up the original
     right-anchored card is restored. */
  return (
    <div className="pointer-events-none fixed bottom-6 left-4 right-4 z-[100] flex flex-col gap-2 sm:left-auto sm:right-6 sm:w-full sm:max-w-sm">
      <AnimatePresence initial={false}>
        {toasts.map(t => (
          <ToastCard key={t.id} {...t} onDismiss={() => popToast(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function ToastCard({
  id, kind, title, body, onDismiss,
}: {
  id:        string
  kind:      ToastKind
  title:     string
  body?:     string
  onDismiss: () => void
}) {
  const s    = STYLES[kind]
  const Icon = s.Icon

  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [id, onDismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0,  scale: 1    }}
      exit={{    opacity: 0, x: 24, scale: 0.96  }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-[var(--color-bg-surface)] p-3.5"
      style={{
        border:     `1px solid ${s.border}`,
        boxShadow:  '0 8px 32px rgba(0,0,0,0.10)',
      }}>
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: s.bg, border: `1px solid ${s.border}` }}>
        <Icon size={15} style={{ color: s.fg }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</p>
        {body && (
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{body}</p>
        )}
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onDismiss}
        className="h-6 w-6 flex-shrink-0 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)]">
        <X size={11} />
      </Button>
    </motion.div>
  )
}
