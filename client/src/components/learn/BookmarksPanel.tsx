'use client'

import { Bookmark, Trash2, Clock } from 'lucide-react'
import { useLessonBookmarks, useDeleteBookmark } from '@/lib/api/bookmarks'
import Spinner from '@/components/ui/Spinner'

function fmtTime(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

interface Props {
  lessonId:   string
  onSeek?:    (timeSecs: number) => void
}

export function BookmarksPanel({ lessonId, onSeek }: Props) {
  const { data: bookmarks, isLoading } = useLessonBookmarks(lessonId)
  const del = useDeleteBookmark(lessonId)

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={18} variant="gray" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
          Bookmarks
        </p>
        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          Use the 🔖 button in the player to add
        </p>
      </div>

      {bookmarks?.length === 0 ? (
        <div className="py-8 text-center">
          <Bookmark size={22} className="mx-auto mb-2" style={{ color: 'var(--color-border)' }} />
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            No bookmarks yet. Click the bookmark button while watching to save a timestamp.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {bookmarks?.map(bm => (
            <div key={bm.id}
              className="group flex items-center gap-2 rounded-xl px-3 py-2 transition-colors"
              style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
              <button
                onClick={() => onSeek?.(bm.timeSecs)}
                className="flex flex-1 items-center gap-2.5 text-left"
                title="Jump to this timestamp">
                <span className="flex h-7 w-14 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-mono font-bold"
                  style={{ background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)' }}>
                  <Clock size={9} className="mr-0.5" />{fmtTime(bm.timeSecs)}
                </span>
                <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {bm.label || `Bookmark at ${fmtTime(bm.timeSecs)}`}
                </span>
              </button>
              <button
                onClick={() => del.mutate(bm.id)}
                disabled={del.isPending}
                aria-label="Delete bookmark"
                /* opacity-0 until group-hover meant that on a touch screen
                   this never appeared at all - there was no way to delete a
                   bookmark on a phone, and an invisible button still sat
                   there collecting taps meant for the row. Visible by
                   default; the hover reveal survives where hover exists. */
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-opacity disabled:opacity-40 sm:h-auto sm:w-auto sm:p-1 sm:opacity-0 sm:group-hover:opacity-100">
                <Trash2 size={13} style={{ color: 'var(--color-danger)' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
