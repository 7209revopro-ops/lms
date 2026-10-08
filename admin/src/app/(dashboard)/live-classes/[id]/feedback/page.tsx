'use client'

import { use } from 'react'
import { motion } from 'framer-motion'
import { Star, MessageSquare, ArrowLeft, Users } from 'lucide-react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'
import Spinner from '@/components/ui/Spinner'
import { CsTag } from '@/components/ui/CsTag'
import type { TetraCs } from '@/lib/api/tetraCs'

interface FeedbackItem {
  _id:    string
  userId: { id: string; name: string; email: string; tetraCs?: TetraCs | null }
  rating: number
  comment?: string
  createdAt: string
}

interface FeedbackSummary {
  feedbacks:     FeedbackItem[]
  averageRating: number | null
  count:         number
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(s => (
        <Star key={s} size={12}
          fill={s <= rating ? '#F59E0B' : 'none'}
          style={{ color: s <= rating ? '#F59E0B' : '#D1D5DB' }} />
      ))}
    </span>
  )
}

export default function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'feedback', id],
    queryFn:  () => apiGet<FeedbackSummary>(`/admin/live-classes/${id}/feedback`),
    staleTime: 30_000,
  })

  const summary   = data as FeedbackSummary | undefined
  const feedbacks = summary?.feedbacks ?? []
  const avg       = summary?.averageRating

  return (
    <div>
      <Link href="/live-classes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-70"
        style={{ color: '#6B7280' }}>
        <ArrowLeft size={14} /><span>Back to Live Classes</span>
      </Link>

      {/* Header card */}
      <div className="mb-6 rounded-2xl bg-white p-5" style={{ border: '1px solid #E4E7ED' }}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)' }}>
            <Star size={18} style={{ color: '#F59E0B' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: '#0D0F1A', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Session Feedback
            </h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>
              Student ratings and comments for this live class
            </p>
          </div>
          {avg !== null && avg !== undefined && (
            <div className="ml-auto flex items-center gap-2">
              <StarRow rating={Math.round(avg)} />
              <span className="text-lg font-bold" style={{ color: '#F59E0B' }}>{avg}</span>
              <span className="text-xs" style={{ color: '#9CA3AF' }}>/ 5 ({summary?.count} reviews)</span>
            </div>
          )}
        </div>
      </div>

      {/* Feedback list */}
      {isLoading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-sm" style={{ color: '#9CA3AF' }}>
          <Spinner size={16} /><span>Loading feedback…</span>
        </div>
      ) : feedbacks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
            <MessageSquare size={22} style={{ color: '#F59E0B' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: '#0D0F1A' }}>No feedback yet</p>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>Students haven't submitted feedback for this session</p>
        </div>
      ) : (
        <div className="space-y-3">
          {feedbacks.map((fb, i) => (
            <motion.div key={fb._id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="rounded-2xl bg-white p-4" style={{ border: '1px solid #E4E7ED' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold" style={{ color: '#0D0F1A' }}>{fb.userId?.name ?? '—'}</p>
                  <p className="text-xs" style={{ color: '#9CA3AF' }}>{fb.userId?.email ?? ''}</p>
                  <CsTag cs={fb.userId?.tetraCs} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StarRow rating={fb.rating} />
                  <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                    {new Date(fb.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
              {fb.comment && (
                <p className="mt-2 text-sm" style={{ color: '#374151' }}>{fb.comment}</p>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
