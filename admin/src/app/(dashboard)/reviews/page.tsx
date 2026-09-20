'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Star, MessageSquare, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAdminReviews, useDeleteReview, type AdminReview } from '@/lib/api/reviews'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'

function reviewer(r: AdminReview) {
  return typeof r.userId === 'object' && r.userId !== null ? r.userId : null
}
function course(r: AdminReview) {
  return typeof r.courseId === 'object' && r.courseId !== null ? r.courseId : null
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ReviewsPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useAdminReviews({ page, per_page: 12 })
  const del   = useDeleteReview()
  const toast = useToast()

  const onDelete = async (r: AdminReview) => {
    if (!confirm('Delete this review? This action cannot be undone.')) return
    try {
      await del.mutateAsync(r.id)
      toast.success('Review deleted')
    } catch (err: any) {
      toast.error('Could not delete review', err?.response?.data?.error?.message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Reviews"
        subtitle="Every review students have submitted, newest first"
        badge={{ label: 'Moderation', color: '#FACC15' }}
      />

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <Spinner size={14} />Loading…
        </div>
      )}

      {!isLoading && data?.docs.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <MessageSquare size={20} style={{ color: 'rgba(255,255,255,0.2)' }} />
          </div>
          <p>No reviews submitted yet.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {data?.docs.map((r, i) => {
          const u = reviewer(r)
          const c = course(r)
          return (
            <motion.div key={r.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025 }}
              className="rounded-2xl p-4 transition-colors hover:bg-white/[0.02]"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
                    style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
                    <AvatarImg src={u?.avatarUrl}
                      className="h-full w-full object-cover"
                      fallback={<span className="text-xs font-bold" style={{ color: '#0057b8' }}>{u?.name?.[0] ?? '?'}</span>} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{u?.name ?? 'Student'}</p>
                    {u?.email && (
                      <p className="truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{u.email}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} size={13} fill={s <= r.rating ? '#FACC15' : 'transparent'}
                      style={{ color: '#FACC15' }} />
                  ))}
                </div>
              </div>

              {r.comment && (
                <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {r.comment}
                </p>
              )}

              <div className="mt-3 flex items-center justify-between text-[11px]"
                style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10, color: 'rgba(255,255,255,0.4)' }}>
                <div className="flex items-center gap-2">
                  <span>{fmtDate(r.createdAt)}</span>
                  <button onClick={() => onDelete(r)} disabled={del.isPending}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                    style={{ color: 'rgba(248,113,113,0.85)' }}>
                    <Trash2 size={10} />Delete
                  </button>
                </div>
                {c && (
                  <Link href={`/courses/${c.id}/edit`} className="font-semibold transition-opacity hover:opacity-70"
                    style={{ color: '#0057b8' }}>
                    {c.title} →
                  </Link>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>

      {data && data.meta.total_pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!data.meta.has_prev}
            className="flex h-8 items-center gap-1 rounded-xl px-3 text-xs font-semibold transition-colors hover:bg-white/[0.08] disabled:opacity-30"
            style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <ChevronLeft size={12} />Previous
          </button>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Page {page} of {data.meta.total_pages}
          </span>
          <button onClick={() => setPage(p => p + 1)} disabled={!data.meta.has_next}
            className="flex h-8 items-center gap-1 rounded-xl px-3 text-xs font-semibold transition-colors hover:bg-white/[0.08] disabled:opacity-30"
            style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Next<ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
