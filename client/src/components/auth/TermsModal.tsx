'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ScrollText, Shield, BookOpen, CreditCard, AlertTriangle, Scale } from 'lucide-react'
import { TERMS_SECTIONS } from '@/lib/legal/terms'

interface TermsModalProps {
  open: boolean
  onClose: () => void
}

/* One icon per section, in order (the text lives in lib/legal/terms.ts). */
const ICONS = [BookOpen, BookOpen, Shield, CreditCard, ScrollText, Shield, AlertTriangle, Shield, ScrollText, ScrollText, ScrollText, Scale]
const SECTIONS = TERMS_SECTIONS.map((s, i) => ({ ...s, icon: ICONS[i] ?? ScrollText }))

export function TermsModal({ open, onClose }: TermsModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: 0 })
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
      /* Two keyed children rather than one fragment. AnimatePresence tracks
         its DIRECT children by key, and a fragment is a single unkeyed child,
         so exit animations on what it wraps do not run. The keys were already
         on the motion elements - they were one level too deep to count. */
    <AnimatePresence>
      {open && (
          <motion.div
            key="terms-backdrop"
            className="fixed inset-0 z-[80]"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
      )}
      {open && (
          <motion.div
            key="terms-modal"
            className="fixed inset-0 z-[81] flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            <div
              className="relative flex flex-col w-full max-w-2xl max-h-[88vh] rounded-2xl overflow-hidden"
              style={{ background: 'var(--color-bg-surface)', boxShadow: '0 24px 80px rgba(0,0,0,0.22)' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex-shrink-0 px-6 py-5" style={{ borderBottom: '1px solid #F0F2F5' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                      style={{ background: 'rgba(0,87,184,0.08)' }}>
                      <ScrollText size={18} style={{ color: 'var(--color-primary)' }} />
                    </div>
                    <div>
                      <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                        Terms &amp; Conditions
                      </h2>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        Delta International Management Development Training · Amended 10th May 2026
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bg-muted)]"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Intro paragraph */}
                <p className="mt-4 text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                  The Terms and Conditions agreed herein govern the participation of the undersigned
                  student in any forex trading course or related course offered by Delta International
                  Management Development Training, an educational initiative providing instructional
                  courses in forex trading and related subjects.
                </p>
              </div>

              {/* Scrollable body */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {SECTIONS.map((section, idx) => {
                  const Icon = section.icon
                  return (
                    <div key={idx}>
                      {/* Section heading */}
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                          style={{ background: 'rgba(0,87,184,0.07)' }}>
                          <Icon size={13} style={{ color: 'var(--color-primary)' }} />
                        </div>
                        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                          {idx + 1}. {section.title}
                        </h3>
                      </div>

                      {/* Section paragraphs */}
                      <div className="space-y-2 pl-9">
                        {section.content.map((para, pIdx) => (
                          <p key={pIdx} className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                            {para}
                          </p>
                        ))}
                      </div>
                    </div>
                  )
                })}

                {/* Acknowledgement */}
                <div className="rounded-xl p-4" style={{ background: 'rgba(0,87,184,0.05)', border: '1px solid rgba(0,87,184,0.14)' }}>
                  <p className="text-[12px] font-semibold mb-1" style={{ color: 'var(--color-primary)' }}>
                    Acknowledgement and Acceptance
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    By submitting your registration form electronically, you confirm that you have read,
                    understood, and agreed to be legally bound by these Terms in full.
                  </p>
                </div>

                <div className="h-2" />
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 flex items-center justify-between gap-3 px-6 py-4"
                style={{ borderTop: '1px solid #F0F2F5' }}>
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  Last updated: 10 May 2026
                </p>
                <button
                  onClick={onClose}
                  className="rounded-xl px-5 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
                  style={{ background: 'var(--color-primary)' }}
                >
                  I Understand
                </button>
              </div>
            </div>
          </motion.div>
      )}
    </AnimatePresence>
  )
}
