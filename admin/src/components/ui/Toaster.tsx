'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'
import { useUIStore, type ToastKind } from '@/store/ui.store'

const STYLES: Record<ToastKind, { fg: string; bg: string; border: string; Icon: React.ElementType }> = {
  success: { fg: '#4ADE80', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.22)', Icon: CheckCircle2 },
  error:   { fg: '#F87171', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.22)', Icon: XCircle      },
  info:    { fg: '#60A5FA', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.22)', Icon: Info        },
}

export function Toaster() {
  const toasts   = useUIStore(s => s.toasts)
  const popToast = useUIStore(s => s.popToast)

  /* `w-full` on a FIXED element resolves against the viewport, not against the
     space left of right-6, so at 375px this was a 375px box pushed 24px right
     and every toast hung 24px off the LEFT edge with its status icon sliced.
     max-w-sm (384px) never clamped it. Same bug the client app had. */
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
  id:       string
  kind:     ToastKind
  title:    string
  body?:    string
  onDismiss: () => void
}) {
  const s = STYLES[kind]
  const Icon = s.Icon

  useEffect(() => {
    /* Auto-dismiss after 4s. */
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [id, onDismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0,  scale: 1   }}
      exit={{    opacity: 0, x: 24, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="pointer-events-auto flex items-start gap-3 rounded-2xl p-3.5"
      style={{
        background:      '#13141C',
        border:          `1px solid ${s.border}`,
        boxShadow:       '0 20px 44px rgba(0,0,0,0.45)',
        backdropFilter:  'blur(8px)',
      }}>
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: s.bg, border: `1px solid ${s.border}` }}>
        <Icon size={15} style={{ color: s.fg }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        {body && (
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {body}
          </p>
        )}
      </div>
      <button onClick={onDismiss}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.05]"
        style={{ color: 'rgba(255,255,255,0.4)' }}>
        <X size={11} />
      </button>
    </motion.div>
  )
}
