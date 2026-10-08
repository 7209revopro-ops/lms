'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Award, Star, AlertTriangle, ChevronDown, ChevronLeft, ChevronRight,
  MessageSquareQuote, AlertCircle, Trophy,
} from 'lucide-react'
import {
  useInstructorLeaderboard, useInstructorReviews, type InstructorLeaderboardRow,
} from '@/lib/api/instructorReviews'
import { AvatarImg } from '@/components/ui/AvatarImg'
import Spinner from '@/components/ui/Spinner'
import { CsTag } from '@/components/ui/CsTag'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/* Gold / silver / bronze for the top three — purely decorative, the sort
   order itself is the real ranking (highest avgRating first, ties broken by
   totalReviews, both computed server-side). */
const RANK_STYLE: Record<number, { bg: string; color: string }> = {
  1: { bg: 'rgba(250,204,21,0.15)', color: '#FACC15' },
  2: { bg: 'rgba(203,213,225,0.15)', color: '#CBD5E1' },
  3: { bg: 'rgba(217,119,6,0.15)', color: '#D97706' },
}

function StarRow({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          size={size}
          fill={n <= Math.round(rating) ? '#FACC15' : 'transparent'}
          style={{ color: n <= Math.round(rating) ? '#FACC15' : 'rgba(255,255,255,0.2)' }}
        />
      ))}
    </div>
  )
}

/* Horizontal 5→1 bar breakdown, widest bar normalized to the row's own max
   so a 2-review instructor's chart isn't a sliver next to a 200-review one. */
function RatingBars({ counts }: { counts: InstructorLeaderboardRow['ratingCounts'] }) {
  const max = Math.max(1, ...Object.values(counts))
  return (
    <div className="flex flex-col gap-0.5">
      {([5, 4, 3, 2, 1] as const).map(star => (
        <div key={star} className="flex items-center gap-1.5">
          <span className="w-2.5 text-[10px] tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>{star}</span>
          <div className="h-1.5 w-20 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${(counts[star] / max) * 100}%`, background: star >= 4 ? '#4ADE80' : star === 3 ? '#FACC15' : '#F87171' }}
            />
          </div>
          <span className="w-5 text-[10px] tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>{counts[star]}</span>
        </div>
      ))}
    </div>
  )
}

function ReviewsDrawer({ instructorId }: { instructorId: string }) {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useInstructorReviews(instructorId, page)

  return (
    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <td colSpan={5} className="px-4 pb-4" style={{ background: 'rgba(255,255,255,0.015)' }}>
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner size={16} variant="muted" /></div>
        ) : !data?.docs.length ? (
          <p className="py-6 text-center text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>No reviews yet.</p>
        ) : (
          <div className="space-y-2 pt-3">
            {data.docs.map(r => (
              <div key={r._id} className="rounded-xl p-3"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StarRow rating={r.rating} />
                      <span className="text-xs font-semibold text-white">{r.studentId?.name ?? 'Student'}</span>
                      <CsTag cs={r.studentId?.tetraCs} />
                    </div>
                    {r.liveClassId && (
                      <p className="mt-0.5 truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {r.liveClassId.title} · {fmtDate(r.liveClassId.scheduledStart)}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{fmtDate(r.createdAt)}</span>
                </div>
                {r.comment && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                    <MessageSquareQuote size={12} className="mt-0.5 shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
                    {r.comment}
                  </p>
                )}
              </div>
            ))}

            {data.meta && data.meta.total_pages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Page {data.meta.page} of {data.meta.total_pages}
                </p>
                <div className="flex gap-1">
                  <button disabled={!data.meta.has_prev} onClick={() => setPage(p => p - 1)}
                    className="rounded-lg p-1 disabled:opacity-30 hover:bg-white/[0.05]">
                    <ChevronLeft size={12} style={{ color: 'white' }} />
                  </button>
                  <button disabled={!data.meta.has_next} onClick={() => setPage(p => p + 1)}
                    className="rounded-lg p-1 disabled:opacity-30 hover:bg-white/[0.05]">
                    <ChevronRight size={12} style={{ color: 'white' }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </td>
    </motion.tr>
  )
}

function LeaderboardRow({ row, rank }: { row: InstructorLeaderboardRow; rank: number }) {
  const [open, setOpen] = useState(false)
  const rankStyle = RANK_STYLE[rank]
  const needsAttention = row.lowRatingCount > 0

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: rank * 0.02 }}
        onClick={() => setOpen(o => !o)}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}
        className="transition-colors hover:bg-white/[0.025]"
      >
        <td className="px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold"
            style={rankStyle ? { background: rankStyle.bg, color: rankStyle.color } : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}>
            {rank <= 3 ? <Trophy size={13} /> : rank}
          </div>
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <AvatarImg
              src={row.avatarUrl}
              name={row.name}
              className="h-8 w-8 rounded-full object-cover"
              fallbackClassName="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
              fallbackStyle={{ background: 'rgba(124,58,237,0.2)', color: '#A78BFA' }}
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate max-w-[180px]">{row.name}</p>
              {needsAttention && (
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: 'rgba(248,113,113,0.15)', color: '#F87171' }}>
                  <AlertTriangle size={9} />Needs attention
                </span>
              )}
            </div>
          </div>
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <StarRow rating={row.avgRating} size={13} />
            <span className="text-xs font-bold tabular-nums" style={{ color: 'white' }}>{row.avgRating.toFixed(1)}</span>
          </div>
        </td>

        <td className="px-4 py-3">
          <RatingBars counts={row.ratingCounts} />
        </td>

        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs font-semibold tabular-nums" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {row.totalReviews} review{row.totalReviews === 1 ? '' : 's'}
            </span>
            <motion.div animate={{ rotate: open ? 180 : 0 }}>
              <ChevronDown size={14} style={{ color: 'rgba(255,255,255,0.4)' }} />
            </motion.div>
          </div>
        </td>
      </motion.tr>
      <AnimatePresence>
        {open && <ReviewsDrawer instructorId={row.instructorId} />}
      </AnimatePresence>
    </>
  )
}

export default function InstructorReviewsPage() {
  const { data, isLoading, isError } = useInstructorLeaderboard()

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(250,204,21,0.15)', border: '1px solid rgba(250,204,21,0.3)' }}>
            <Award size={16} style={{ color: '#FACC15' }} />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Instructor Reviews
          </h1>
        </div>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Student ratings collected after each class, ranked highest-rated first. Click a row to read individual reviews.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Rank', 'Instructor', 'Rating', 'Breakdown', 'Reviews'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold"
                    style={{ color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="py-16 text-center"><Spinner size={18} variant="muted" /></td></tr>
              ) : isError ? (
                <tr><td colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle size={22} style={{ color: '#F87171' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Failed to load instructor reviews</p>
                  </div>
                </td></tr>
              ) : !data?.length ? (
                <tr><td colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Star size={22} style={{ color: 'rgba(255,255,255,0.2)' }} />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No reviews submitted yet.</p>
                  </div>
                </td></tr>
              ) : data.map((row, i) => (
                <LeaderboardRow key={row.instructorId} row={row} rank={i + 1} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
