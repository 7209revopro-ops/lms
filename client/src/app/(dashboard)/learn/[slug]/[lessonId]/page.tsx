'use client'

import { use, useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowLeft, CheckCircle2, Lock, AlertCircle,
  ChevronLeft, ChevronRight, ChevronDown, Play, Circle, Bookmark,
  List, MessageSquare, FileText, BookmarkIcon, AlignLeft, Video,
  RotateCcw, RotateCw,
} from 'lucide-react'
import { MediaPlayer, MediaProvider, type MediaPlayerInstance } from '@vidstack/react'
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import { useCourse, useLessonPlayUrl, type LessonOutline } from '@/lib/api/courses'
import { useCourseProgress } from '@/lib/api/enrollments'
import { useCurrentUser } from '@/lib/api/user'
import { useMarkLessonComplete, recordWatchTime, useMyLessonProgress } from '@/lib/api/progress'
import { useCreateBookmark } from '@/lib/api/bookmarks'
import { useTranscript } from '@/lib/api/transcript'
import { QuizPlayer } from '@/components/learn/QuizPlayer'
import { DiscussionPanel } from '@/components/learn/DiscussionPanel'
import { NotesPanel } from '@/components/learn/NotesPanel'
import { BookmarksPanel } from '@/components/learn/BookmarksPanel'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/Spinner'
import { WatermarkOverlay } from '@/components/video/WatermarkOverlay'

type SidebarTab = 'curriculum' | 'transcript' | 'qa' | 'notes' | 'bookmarks'

function fmt(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`
}

export default function LessonPlayerPage({ params }: { params: Promise<{ slug: string; lessonId: string }> }) {
  const { slug, lessonId } = use(params)
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<SidebarTab>('curriculum')

  const { data: user } = useCurrentUser()
  const { data, isLoading, isError } = useCourse(slug)
  const { data: progress } = useCourseProgress(slug)
  const markComplete = useMarkLessonComplete(slug)

  /* Expose player ref so BookmarkPanel's onSeek can seek to a timestamp */
  const playerRef = useRef<MediaPlayerInstance>(null)
  const seekTo = useCallback((secs: number) => {
    if (playerRef.current) playerRef.current.currentTime = secs
  }, [])

  /* ── All remaining hooks — must be before any early return ── */
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { data: transcriptData, isLoading: transcriptLoading } = useTranscript(lessonId)
  const transcriptText = transcriptData?.transcript ?? null

  /* ── Loading / error states ─────────────────────── */
  if (isLoading) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3">
        <Spinner size={30} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading lesson…</p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />
        </div>
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Course not found</p>
        <Link href="/courses" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>← Back to courses</Link>
      </div>
    )
  }

  /* ── Viewer gate — pending students cannot access lesson content ── */
  if (user && user.role === 'student' && user.enrollmentStatus === 'pending') {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <Lock size={22} style={{ color: 'var(--color-warning)' }} />
        </div>
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Lesson locked (viewer mode)</p>
        <p className="max-w-xs text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Your account is pending admin approval. Course content will be unlocked once you're approved.
        </p>
        <Link href={`/courses/${slug}`}
          className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
          style={{ background: 'var(--color-primary)' }}>
          Back to course
        </Link>
      </div>
    )
  }

  /* ── Enrollment gate (skip for free-preview lessons) ── */
  const thisLesson = data?.lessons?.find(l => l.id === lessonId)
  if (progress && !progress.isEnrolled && !thisLesson?.isFree) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(0,87,184,0.10)', border: '1px solid rgba(0,87,184,0.22)' }}>
          <Lock size={22} style={{ color: 'var(--color-primary)' }} />
        </div>
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>You need to enroll to watch this lesson</p>
        <Link href={`/courses/${slug}`}
          className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
          style={{ background: 'var(--color-primary)' }}>
          Go to course page
        </Link>
      </div>
    )
  }

  /* ── Blocked-lesson gate ── */
  if (progress?.isEnrolled && (progress.blockedLessons ?? []).includes(lessonId)) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.22)' }}>
          <Lock size={22} style={{ color: '#6366F1' }} />
        </div>
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>This lesson is not available to you</p>
        <p className="text-sm text-center max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
          Your instructor has restricted access to this lesson. Contact them for more information.
        </p>
        <Link href={`/courses/${slug}`}
          className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
          style={{ background: '#6366F1' }}>
          Back to course
        </Link>
      </div>
    )
  }

  const { course, sections, lessons } = data
  const lesson = lessons.find(l => l.id === lessonId)
  const orderedLessons = [...lessons].sort((a, b) =>
    a.sectionId === b.sectionId ? a.order - b.order : 0,
  )
  const currentIdx = orderedLessons.findIndex(l => l.id === lessonId)
  const prevLesson = currentIdx > 0 ? orderedLessons[currentIdx - 1] : null
  const nextLesson = currentIdx >= 0 && currentIdx < orderedLessons.length - 1
    ? orderedLessons[currentIdx + 1]
    : null

  if (!lesson) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4">
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Lesson not found in this course</p>
        <Link href={`/courses/${slug}`} className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Back to course
        </Link>
      </div>
    )
  }

  const completedSet = new Set(progress?.completedLessons ?? [])
  const isCompleted  = completedSet.has(lessonId)

  const tabs: { key: SidebarTab; label: string; icon: React.ReactNode }[] = [
    { key: 'curriculum', label: 'Content',    icon: <List size={12} /> },
    { key: 'transcript', label: 'Transcript', icon: <AlignLeft size={12} /> },
    { key: 'qa',         label: 'Q&A',        icon: <MessageSquare size={12} /> },
    { key: 'notes',      label: 'Notes',      icon: <FileText size={12} /> },
    { key: 'bookmarks',  label: 'Bookmarks',  icon: <BookmarkIcon size={12} /> },
  ]

  /* ── Sidebar content (shared between desktop aside and mobile drawer) */
  const SidebarContent = () => (
    <>
      {/* Tab bar */}
      <div className="flex border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
        {tabs.map(t => (
          <Button key={t.key} onClick={() => setActiveTab(t.key)}
            variant="ghost"
            className="flex flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-semibold transition-colors h-auto rounded-none"
            style={{
              color:        activeTab === t.key ? '#0057b8' : 'var(--color-text-muted)',
              borderBottom: activeTab === t.key ? '2px solid #0057b8' : '2px solid transparent',
            }}>
            {t.icon}{t.label}
          </Button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'curriculum' && (
          <div>
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Course</p>
              <p className="mt-0.5 text-sm font-bold line-clamp-2" style={{ color: 'var(--color-text-primary)' }}>{course.title}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
                  <motion.div className="h-full rounded-full"
                    initial={{ width: 0 }} animate={{ width: `${progress?.progressPercent ?? 0}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }} style={{ background: 'var(--color-success)' }} />
                </div>
                <span className="text-[11px] font-semibold" style={{ color: 'var(--color-success)' }}>{progress?.progressPercent ?? 0}%</span>
              </div>
            </div>
            <div className="p-2">
              {sections.map((s, si) => {
                const sectionLessons = lessons.filter(l => l.sectionId === s.id).sort((a, b) => a.order - b.order)
                return (
                  <div key={s.id} className={si > 0 ? 'mt-3' : ''}>
                    <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>{s.title}</p>
                    {sectionLessons.map(l => {
                      const isCurrent = l.id === lessonId
                      const done = completedSet.has(l.id)
                      return (
                        <Link key={l.id} href={`/learn/${slug}/${l.id}`} onClick={() => setSidebarOpen(false)}>
                          <div className="group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors"
                            style={isCurrent ? { background: 'rgba(0,87,184,0.10)' } : {}}
                            onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--color-bg-page)' }}
                            onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent' }}>
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                              {done ? <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
                                : isCurrent ? <Play size={12} fill="#0057b8" color="#0057b8" />
                                  : <Circle size={14} style={{ color: 'var(--color-text-muted)' }} />}
                            </span>
                            <p className="flex-1 text-xs leading-snug line-clamp-2"
                              style={{ color: isCurrent ? '#0057b8' : done ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', fontWeight: isCurrent ? 600 : 500 }}>
                              {l.title}
                            </p>
                            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{fmt(l.durationMins)}</span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {activeTab === 'transcript' && (
          <div className="p-4">
            {transcriptLoading ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                <Spinner size={14} />Loading transcript…
              </div>
            ) : transcriptText ? (
              <div>
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                  Lesson transcript
                </p>
                <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {transcriptText.split(/\n\n+/).map((para, i) => (
                    <p key={i}>{para.trim()}</p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <AlignLeft size={28} style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>No transcript yet</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  The instructor hasn&apos;t added a transcript for this lesson.
                </p>
              </div>
            )}
          </div>
        )}
        {activeTab === 'qa'        && <div className="p-3"><DiscussionPanel lessonId={lessonId} /></div>}
        {activeTab === 'notes'     && <div className="p-3"><NotesPanel lessonId={lessonId} /></div>}
        {activeTab === 'bookmarks' && <div className="p-3"><BookmarksPanel lessonId={lessonId} onSeek={seekTo} /></div>}
      </div>
    </>
  )

  return (
    <div className="mx-auto max-w-[1280px]">
      {/* Back nav */}
      <div className="mb-4">
        <Link href={`/courses/${slug}`} className="inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}>
          <ArrowLeft size={13} />Back to course
        </Link>
      </div>

      {/* ── Desktop: two-column  Mobile: stacked (main first) ── */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[320px_1fr]">

        {/* ── Main player (order-first on all sizes) ───── */}
        <main className="lg:order-2 min-w-0">
          {lesson.type === 'quiz'
            ? <QuizPlayer lessonId={lesson.id} onPassed={() => { if (nextLesson) router.push(`/learn/${slug}/${nextLesson.id}`) }} />
            : lesson.type === 'article'
            ? <ArticleReader lesson={lesson} />
            : <PlayerArea lesson={lesson} playerRef={playerRef} lessonId={lessonId} />}

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-[var(--color-bg-surface)] p-4" style={{ border: '1px solid var(--color-border)' }}>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                Lesson {currentIdx + 1} / {orderedLessons.length}
              </p>
              <h2 className="mt-0.5 truncate text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                {lesson.title}
              </h2>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{fmt(lesson.durationMins)}</p>
            </div>
            <div className="flex items-center gap-2">
              {prevLesson && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/learn/${slug}/${prevLesson.id}`)}
                  className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold">
                  <ChevronLeft size={14} />Prev
                </Button>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={async () => { await markComplete.mutateAsync(lessonId); if (nextLesson) router.push(`/learn/${slug}/${nextLesson.id}`) }}
                disabled={markComplete.isPending}
                className="flex items-center gap-1 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-60"
                style={{ background: isCompleted ? '#22C55E' : '#0057b8' }}>
                {markComplete.isPending
                  ? <><Spinner size={13} />Saving…</>
                  : isCompleted
                    ? <><CheckCircle2 size={13} />Completed</>
                    : <>Mark complete{nextLesson ? ' & next' : ''}{nextLesson && <ChevronRight size={13} />}</>}
              </Button>
            </div>
          </div>

          {/* ── Mobile: inline sidebar accordion ── */}
          <div className="mt-4 lg:hidden">
            <Button
              variant="ghost"
              onClick={() => setSidebarOpen(v => !v)}
              className="flex w-full items-center justify-between rounded-2xl bg-[var(--color-bg-surface)] px-4 py-3 h-auto"
              style={{ border: '1px solid var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                <List size={14} className="inline mr-2 -mt-0.5" style={{ color: 'var(--color-primary)' }} />
                Course content
              </span>
              <ChevronDown size={16} style={{ color: 'var(--color-text-muted)', transform: sidebarOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </Button>
            {sidebarOpen && (
              <div className="mt-2 flex flex-col rounded-2xl bg-[var(--color-bg-surface)] overflow-hidden max-h-[60vh]"
                style={{ border: '1px solid var(--color-border)' }}>
                <SidebarContent />
              </div>
            )}
          </div>
        </main>

        {/* ── Sidebar — desktop only ───────────────────── */}
        <aside className="hidden lg:flex lg:order-1 rounded-2xl bg-[var(--color-bg-surface)] flex-col max-h-[calc(100vh-160px)]"
          style={{ border: '1px solid var(--color-border)' }}>
          <SidebarContent />
        </aside>
      </div>
    </div>
  )
}

/* ─── Article / PDF reader ────────────────────────────
   An 'article' lesson carries its content in contentUrl (a PDF or resource
   link, and/or an uploaded file) and optionally contentBody (rich text). The
   backend ships both to enrolled/free viewers; this renders them. Before this
   existed the page treated every non-quiz lesson as a video and article
   lessons showed "No video available", so admin-published PDFs and articles
   were unreadable on the student side. */
function ArticleReader({ lesson }: { lesson: LessonOutline }) {
  const url  = lesson.contentUrl?.trim()
  const body = lesson.contentBody?.trim()
  const isImage = !!url && /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url)
  const isPdf   = !!url && /\.pdf(\?|$)/i.test(url)
  /* Anything that is neither an image nor an obvious PDF still gets an inline
     frame attempt, because most resource links (PDFs without an extension,
     Google Docs, slides) render in an iframe — and the open-in-new-tab link
     below is always there as the guaranteed fallback. */
  const canEmbed = !!url && !isImage

  if (!url && !body) {
    return (
      <div data-protected-content className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl"
        style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl"
          style={{ background: 'var(--color-bg-muted)', border: '1px solid var(--color-border)' }}>
          <FileText size={28} style={{ color: 'var(--color-text-muted)' }} />
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          This article has no content yet.
        </p>
      </div>
    )
  }

  return (
    <div data-protected-content className="space-y-4">
      {/* Rich-text body — rendered as whitespace-preserving text (never as raw
          HTML) so a content author cannot inject script into the student app. */}
      {body && (
        <div className="rounded-2xl p-6" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
            {body}
          </p>
        </div>
      )}

      {/* The resource itself */}
      {url && isImage && (
        <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid var(--color-border)' }}>
          <img src={url} alt={lesson.title} className="h-auto w-full" />
        </div>
      )}

      {url && canEmbed && (
        <div className="overflow-hidden rounded-2xl bg-[var(--color-bg-inset)]" style={{ border: '1px solid var(--color-border)', height: '78vh' }}>
          <iframe
            src={url}
            title={lesson.title}
            className="h-full w-full"
            style={{ border: 'none' }}
          />
        </div>
      )}

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ background: '#0057b8' }}>
          <FileText size={15} />
          {isPdf ? 'Open PDF in a new tab' : isImage ? 'Open image in a new tab' : 'Open resource in a new tab'}
        </a>
      )}
    </div>
  )
}

/* ─── Vidstack player + watch-time tracker + bookmark ── */
function PlayerArea({
  lesson,
  playerRef,
  lessonId,
}: {
  lesson:    LessonOutline
  playerRef: React.RefObject<MediaPlayerInstance | null>
  lessonId:  string
}) {
  const lastReportRef  = useRef(0)
  const seekedToResume = useRef(false)
  /* Video src is a short-lived signed URL fetched on demand — never embedded
     in the course payload (see backend courseDTO / GET /lessons/:id/play-url). */
  const { data: playData, isLoading: playUrlLoading } = useLessonPlayUrl(lesson.id, !!lesson.hasVideo)
  const videoSrc = playData?.url
  const { data: lessonProgress } = useMyLessonProgress(lesson.id)
  const createBookmark = useCreateBookmark(lessonId)
  const [bookmarking,   setBookmarking]   = useState(false)
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const [showBmForm,    setShowBmForm]    = useState(false)

  useEffect(() => {
    lastReportRef.current  = 0
    seekedToResume.current = false
    setShowBmForm(false)
  }, [lesson.id])

  /* Resume from last watch position once metadata is loaded */
  const onLoadedMetadata = () => {
    if (seekedToResume.current) return
    const player = playerRef.current
    if (!player) return
    const target   = lessonProgress?.watchTimeSecs ?? 0
    const duration = isFinite(player.duration) ? player.duration : Infinity
    if (target >= 10 && target < duration - 15) {
      player.currentTime    = target
      lastReportRef.current = Math.floor(target)
    }
    seekedToResume.current = true
  }

  /* Report watch-time every 15 seconds */
  const onTimeUpdate = () => {
    const player = playerRef.current
    if (!player) return
    const current = Math.floor(player.currentTime)
    if (current - lastReportRef.current >= 15) {
      const delta = current - lastReportRef.current
      lastReportRef.current = current
      recordWatchTime(lesson.id, delta)
    }
  }

  /* Skip ±10 seconds */
  const skip = useCallback((secs: number) => {
    const player = playerRef.current
    if (!player) return
    const next = Math.max(0, Math.min(player.currentTime + secs, player.duration || Infinity))
    player.currentTime = next
  }, [])

  /* Bookmark at current timestamp */
  const addBookmark = async () => {
    const player = playerRef.current
    if (!player) return
    const timeSecs = Math.floor(player.currentTime)
    setBookmarking(true)
    try {
      await createBookmark.mutateAsync({ timeSecs, label: bookmarkLabel.trim() || undefined })
      setShowBmForm(false)
      setBookmarkLabel('')
    } finally {
      setBookmarking(false)
    }
  }

  const showResumeBadge = !seekedToResume.current && (lessonProgress?.watchTimeSecs ?? 0) >= 10

  return (
    <div className="space-y-2">
      <div data-protected-content className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '16 / 9' }}>
        {lesson.hasVideo && videoSrc ? (
          <MediaPlayer
            ref={playerRef}
            key={lesson.id}
            src={videoSrc}
            className="h-full w-full"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
          >
            <MediaProvider />
            <DefaultVideoLayout icons={defaultLayoutIcons} />
            {/* Inside <MediaPlayer> on purpose: Vidstack fullscreens the
                player element itself, so a sibling overlay would vanish in
                fullscreen — a child stays composited over the video. */}
            <WatermarkOverlay />
          </MediaPlayer>
        ) : lesson.hasVideo ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            <span className="ml-3 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {playUrlLoading ? 'Loading video…' : 'Video unavailable'}
            </span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)' }}>
              <Video size={28} style={{ color: 'rgba(255,255,255,0.35)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
              No video available for this lesson yet.
            </p>
          </div>
        )}

        {/* Resume badge */}
        {showResumeBadge && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white"
            style={{ background: 'rgba(13,15,26,0.72)', backdropFilter: 'blur(4px)' }}>
            Resuming from {Math.floor((lessonProgress!.watchTimeSecs) / 60)}:{String((lessonProgress!.watchTimeSecs) % 60).padStart(2, '0')}
          </div>
        )}

        {/* Skip ±10s buttons — bottom-center, above Vidstack controls */}
        {videoSrc && (
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-auto">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => skip(-10)}
              title="Skip back 10 seconds"
              className="group flex flex-col items-center justify-center gap-0.5 h-9 w-9 rounded-full transition-all hover:scale-110 active:scale-95 !bg-transparent hover:!bg-transparent"
              style={{ background: 'rgba(13,15,26,0.72)', backdropFilter: 'blur(4px)' }}>
              <RotateCcw size={13} className="text-white" />
              <span className="text-[8px] font-bold leading-none text-white/80">10</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => skip(10)}
              title="Skip forward 10 seconds"
              className="group flex flex-col items-center justify-center gap-0.5 h-9 w-9 rounded-full transition-all hover:scale-110 active:scale-95 !bg-transparent hover:!bg-transparent"
              style={{ background: 'rgba(13,15,26,0.72)', backdropFilter: 'blur(4px)' }}>
              <RotateCw size={13} className="text-white" />
              <span className="text-[8px] font-bold leading-none text-white/80">10</span>
            </Button>
          </div>
        )}

        {/* Bookmark overlay — bottom-right */}
        <div className="absolute bottom-14 right-3 flex items-center gap-2">
          {showBmForm && (
            <div className="flex items-center gap-1.5 rounded-xl px-2 py-1.5"
              style={{ background: 'rgba(13,15,26,0.82)', backdropFilter: 'blur(4px)' }}>
              <input
                value={bookmarkLabel}
                onChange={e => setBookmarkLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addBookmark()
                  if (e.key === 'Escape') setShowBmForm(false)
                }}
                placeholder="Label (optional)"
                autoFocus
                className="w-36 bg-transparent text-xs text-white outline-none placeholder:text-white/50"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={addBookmark}
                disabled={bookmarking}
                className="h-auto p-0 text-xs font-semibold hover:bg-transparent"
                style={{ color: 'var(--color-primary)' }}>
                {bookmarking ? '…' : 'Save'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBmForm(false)}
                className="h-auto p-0 text-xs hover:bg-transparent"
                style={{ color: 'rgba(255,255,255,0.5)' }}>
                ✕
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowBmForm(f => !f)}
            title="Add bookmark at current time"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-80 hover:!bg-transparent"
            style={{ background: 'rgba(13,15,26,0.72)', backdropFilter: 'blur(4px)' }}>
            <Bookmark size={14} className="text-white" />
          </Button>
        </div>
      </div>
    </div>
  )
}
