'use client'
/* A sheet: a bottom drawer on a phone (with a grab handle), a centred popup
   from `sm` up. Escape and the backdrop close it.

   On a phone it can be swiped down to close, from anywhere on it: the
   header, the handle, or a list that is already scrolled to the top (a
   scrolled list scrolls back up first, like a native sheet). Touch events,
   not pointer events — a browser cancels pointer events as soon as it
   decides a gesture is a scroll. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { X } from 'lucide-react'

const CLOSE_DISTANCE = 110   // px dragged down
const CLOSE_VELOCITY = 0.6   // px per ms, a quick flick

/* The nearest element between `el` and the sheet that scrolls vertically. */
function scrollerOf(el: EventTarget | null, sheet: HTMLElement): HTMLElement | null {
  for (let n = el as HTMLElement | null; n && n !== sheet; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n
  }
  return null
}

export function BottomSheet({ children, onClose, label, wide }: { children: React.ReactNode; onClose: () => void; label: string; wide?: boolean }) {
  /* Rendered into <body>: inside an animated (transformed) parent, `fixed`
     would be fixed to that parent instead of the screen. */
  const [host, setHost] = useState<HTMLElement | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragY = useMotionValue(0)
  const backdrop = useTransform(dragY, [0, 400], [1, 0.2])
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => setHost(document.body), [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev }
  }, [onClose])

  /* Swipe down to close — phones only (below `sm`, where it is a drawer). */
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    let startY = 0, lastY = 0, lastT = 0, velocity = 0
    let scroller: HTMLElement | null = null
    let dragging = false, tracking = false

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.matchMedia('(min-width: 640px)').matches) { tracking = false; return }
      tracking = true; dragging = false
      startY = lastY = e.touches[0]!.clientY; lastT = e.timeStamp; velocity = 0
      scroller = scrollerOf(e.target, sheet)
    }
    const move = (e: TouchEvent) => {
      if (!tracking) return
      const y = e.touches[0]!.clientY
      const dy = y - startY
      if (!dragging) {
        if (dy < 6) { if (dy < -6) tracking = false; return }   // an upward swipe is a scroll
        if (scroller && scroller.scrollTop > 0) { tracking = false; return }
        dragging = true; startY = y; lastY = y
      }
      e.preventDefault()   // the sheet moves, the page does not
      const dt = Math.max(1, e.timeStamp - lastT)
      velocity = (y - lastY) / dt
      lastY = y; lastT = e.timeStamp
      dragY.set(Math.max(0, y - startY))
    }
    const end = () => {
      if (!tracking) return
      tracking = false
      if (!dragging) return
      dragging = false
      if (dragY.get() > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) closeRef.current()
      else animate(dragY, 0, { type: 'spring', stiffness: 420, damping: 36 })
    }

    sheet.addEventListener('touchstart', start, { passive: true })
    sheet.addEventListener('touchmove', move, { passive: false })
    sheet.addEventListener('touchend', end)
    sheet.addEventListener('touchcancel', end)
    return () => {
      sheet.removeEventListener('touchstart', start)
      sheet.removeEventListener('touchmove', move)
      sheet.removeEventListener('touchend', end)
      sheet.removeEventListener('touchcancel', end)
    }
  }, [host, dragY])

  if (!host) return null
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={label}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0" onClick={onClose}>
        <motion.div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" style={{ opacity: backdrop }} />
      </motion.div>
      <motion.div ref={sheetRef} style={{ y: dragY }} className={`relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <motion.div initial={{ opacity: 0, y: 48 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 48 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="relative flex max-h-[85dvh] w-full flex-col rounded-t-3xl bg-[var(--color-bg-surface)] sm:rounded-3xl"
          style={{ boxShadow: '0 24px 64px rgba(15,23,42,0.22)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <span aria-hidden className="mx-auto mt-2.5 block h-1.5 w-10 flex-shrink-0 rounded-full sm:hidden" style={{ background: 'var(--color-border)' }} />
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 rounded-full p-2 hover:bg-[var(--color-bg-muted)]">
            <X size={16} style={{ color: 'var(--color-text-muted)' }} />
          </button>
          {children}
        </motion.div>
      </motion.div>
    </div>,
    host,
  )
}
