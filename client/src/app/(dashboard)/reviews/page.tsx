'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, MessageSquareQuote, CheckCircle2, GraduationCap, CalendarDays } from 'lucide-react'
import { usePendingReviews, useSubmitInstructorReview, type PendingReview } from '@/lib/api/instructorReviews'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/* ── Star picker — hover previews the rating, click commits it. Five large
   tap targets rather than a slider: this is a phone-first flow (reached from
   a WhatsApp tap), and a slider is a worse touch target than five buttons. */
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div className="flex items-center gap-1.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className="transition-transform hover:scale-110 active:scale-95"
        >
          <Star
            size={32}
            fill={n <= shown ? '#FACC15' : 'transparent'}
            style={{ color: n <= shown ? '#FACC15' : 'var(--color-border)' }}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  )
}

const RATING_LABEL: Record<number, string> = {
  1: 'Not great',
  2: 'Could be better',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
}

function ReviewCard({ item, index }: { item: PendingReview; index: number }) {
  const [rating,  setRating]  = useState(0)
  const [comment, setComment] = useState('')
  const [done,    setDone]    = useState(false)
  const submit = useSubmitInstructorReview()
  const toast  = useToast()

  const handleSubmit = async () => {
    if (rating === 0) return
    try {
      await submit.mutateAsync({ liveClassId: item.liveClassId, rating, comment: comment.trim() || undefined })
      setDone(true)
    } catch (err: any) {
      toast.error('Could not submit your rating', err?.response?.data?.error?.message)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 300, damping: 28 }}
      className="overflow-hidden rounded-2xl"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>{item.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <span className="flex items-center gap-1"><GraduationCap size={12} />{item.instructorName}</span>
              <span className="flex items-center gap-1"><CalendarDays size={12} />{fmtDate(item.scheduledStart)}</span>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="mt-4 flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold"
              style={{ background: 'rgba(34,197,94,0.1)', color: '#16A34A' }}
            >
              <CheckCircle2 size={16} />Thanks for your feedback!
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="mt-4 flex items-center justify-between">
                <StarPicker value={rating} onChange={setRating} />
                <span className="text-xs font-semibold" style={{ color: rating ? '#F59E0B' : 'var(--color-text-muted)' }}>
                  {rating ? RATING_LABEL[rating] : 'Tap a star'}
                </span>
              </div>

              <div className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}>
                <MessageSquareQuote size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="Anything you'd like to add? (optional)"
                  className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)]"
                  style={{ color: 'var(--color-text-primary)' }}
                />
              </div>

              <button
                type="button"
                disabled={rating === 0 || submit.isPending}
                onClick={handleSubmit}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {submit.isPending && <Spinner size={13} />}
                Submit rating
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export default function ReviewsPage() {
  const { data, isLoading } = usePendingReviews()
  const items = data ?? []

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Star size={14} fill="#FACC15" style={{ color: '#FACC15' }} />
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#CA8A04' }}>
            Your feedback
          </span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Rate Your Classes
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          A minute of feedback on a class you attended helps us support instructors and improve future sessions.
        </p>
      </motion.div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <Spinner size={14} />Loading…
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{ background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.25)' }}>
            <Star size={22} style={{ color: '#CA8A04' }} />
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Nothing to rate right now</p>
          <p className="max-w-xs text-sm" style={{ color: 'var(--color-text-muted)' }}>
            After you attend a live class, it'll show up here so you can rate it.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <AnimatePresence>
          {items.map((item, i) => (
            <ReviewCard key={item.liveClassId} item={item} index={i} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
