import { useMemo, useState } from 'react'
import { Alert, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { useTranslation } from 'react-i18next'
import {
  durationLabel, lessonGate, lessonSequence, outlineOf, problemOf, resumeLesson,
  type CourseProgress, type CourseSummary, type LessonOutline,
} from '@shared'
import { useCourse, useCourseProgress } from '@/lib/api/learning'
import {
  reportReview, toggleHelpful, useAiNotes, useCourseReviews, useEnrollFree, useIsFavorite, useRatingHistogram,
  useRecommendations, useToggleFavorite, useWriteReview,
} from '@/lib/api/catalog'
import { certificatePath, useExamInfo } from '@/lib/api/engage'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { canSaveFiles, downloadAndShare } from '@/lib/files'
import { haptic } from '@/lib/haptics'
import { Avatar, Badge, Button, Card, Field, Glyph, IconButton, Notice, ProgressBar, Segmented } from '@/components/ui'
import { CourseRow, StarInput, Stars } from '@/components/catalog'
import { Img } from '@/components/media'
import { CourseLiveClasses } from '@/components/schedule'
import { Empty, Failed, Loading } from '@/components/states'
import { useToast } from '@/components/toast'
import { useTheme } from '@/theme'

const TYPE_ICON = { video: 'play-circle-outline', article: 'document-text-outline', quiz: 'help-circle-outline' } as const
type Tab = 'curriculum' | 'about' | 'reviews'

/* A course — the website's course page and the app's outline in one:
   cover, rating and stats, the instructor, the student's progress, then
   Curriculum / About / Reviews. The one big action (Resume, Start, Enrol free)
   stays at the bottom. Paid courses a student is not on show no price and no
   buy button (plan.md M6) — the website hides prices too. */
export default function CoursePage() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const toast = useToast()
  const { state } = useAuth()
  const enrollmentStatus = state.status === 'signedIn' ? state.user.enrollmentStatus : undefined
  const approved = enrollmentStatus === 'approved'
  const pending = enrollmentStatus === 'pending'

  const course = useCourse(slug)
  const headerHeight = useHeaderHeight()
  /* /progress refuses students who are not approved; they browse the outline. */
  const progress = useCourseProgress(slug, approved)
  const enroll = useEnrollFree(slug ?? '')
  const [tab, setTab] = useState<Tab>('curriculum')
  const [refreshing, setRefreshing] = useState(false)

  const seq = useMemo(() => (course.data ? lessonSequence(course.data) : []), [course.data])
  const resume = useMemo(() => (course.data ? resumeLesson(seq, progress.data) : undefined), [course.data, seq, progress.data])

  const refresh = async () => {
    setRefreshing(true)
    try { await Promise.all([course.refetch(), approved ? progress.refetch() : null]) } finally { setRefreshing(false) }
  }

  if (course.isLoading) return <View style={{ padding: 16 }}><Loading cards={2} media /></View>
  if (course.error || !course.data) return <Failed error={course.error} onRetry={() => void refresh()} />

  const c = course.data.course
  const enrolled = !!progress.data?.isEnrolled && progress.data.status !== 'dropped'
  const open = (l: LessonOutline) => router.push({ pathname: '/learning/[slug]/[lessonId]', params: { slug: slug!, lessonId: l.id } })
  const started = (progress.data?.completedLessons.length ?? 0) > 0 || !!progress.data?.lastLessonId

  const doEnroll = () => enroll.mutate(c.id, {
    onSuccess: () => { toast(t('catalog.enrolledToast')); setTab('curriculum') },
    onError: e => {
      const p = problemOf(e)
      toast(p.kind === 'refused' && p.code === 'PAYMENT_REQUIRED' ? t('catalog.paidOnly') : errorText(e), 'danger')
    },
  })

  /* The single action at the bottom, by situation. */
  const action = enrolled && resume
    ? <Button title={started ? t('learning.resume') : t('learning.start')} onPress={() => open(resume)} />
    : !enrolled && approved && c.isFree
      ? <Button title={t('catalog.enrollFree')} loading={enroll.isPending} onPress={doEnroll} />
      : null

  return (
    <>
      <Stack.Screen options={{ title: '', headerRight: () => <FavoriteHeart course={c} /> }} />
      {/* The review comment and its Post button must stay above the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: action ? 104 : 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}>
        <Hero course={c} lessons={seq.length} />

        <View style={{ padding: 16, gap: 16 }}>
          {pending && <Notice tone="info">{t('learning.pendingBody')}</Notice>}
          {enrolled && <EnrolledPanel progress={progress.data!} title={c.title} />}
          {!enrolled && approved && !c.isFree && <Notice tone="info">{t('catalog.paidNotice')}</Notice>}
          {enrolled && <ExamCard courseId={c.id} slug={slug!} />}
          {enrolled && <CourseLiveClasses courseId={c.id} />}

          <Segmented<Tab> value={tab} onChange={setTab} options={[
            { value: 'curriculum', label: t('catalog.tabs.curriculum') },
            { value: 'about', label: t('catalog.tabs.about') },
            { value: 'reviews', label: t('catalog.tabs.reviews') },
          ]} />

          {tab === 'curriculum' && <Curriculum detail={course.data} progress={progress.data} enrollmentStatus={enrollmentStatus} onOpen={open} />}
          {tab === 'about' && <About course={c} slug={slug!} />}
          {tab === 'reviews' && <Reviews course={c} slug={slug!} canWrite={enrolled} />}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {action && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
          backgroundColor: colors.bgSurface, borderTopWidth: 1, borderTopColor: colors.border }}>
          {action}
        </View>
      )}
    </>
  )
}

function FavoriteHeart({ course }: { course: CourseSummary }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const fav = useIsFavorite(course.id)
  const toggle = useToggleFavorite(course)
  const on = !!fav.data
  return (
    <IconButton icon={on ? 'heart' : 'heart-outline'} color={on ? colors.danger : colors.textPrimary} active={on}
      label={on ? t('favorites.remove') : t('favorites.add')}
      onPress={() => { haptic.tap(); toggle.mutate(!on) }} />
  )
}

function Hero({ course: c, lessons }: { course: CourseSummary; lessons: number }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const dur = durationLabel(c.durationMins)
  const facts = [
    dur && { icon: 'time-outline' as const, text: dur },
    lessons > 0 && { icon: 'list-outline' as const, text: t('catalog.lessons', { count: lessons }) },
    c.language && { icon: 'globe-outline' as const, text: c.language },
    !!c.enrolledCount && { icon: 'people-outline' as const, text: t('catalog.students', { count: c.enrolledCount }) },
  ].filter(Boolean) as { icon: 'time-outline'; text: string }[]
  return (
    <View>
      <Img cover uri={c.thumbnailUrl} style={{ width: '100%', aspectRatio: 16 / 9 }} placeholderColor={colors.primaryLight} accessibilityLabel={c.title} />
      <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {c.category && <Text style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, color: colors.primary }}>{c.category.name.toUpperCase()}</Text>}
          {c.level && <Badge label={t(`catalog.level.${c.level}`)} tone="muted" />}
        </View>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.textPrimary }}>{c.title}</Text>
        <Stars value={c.ratingAvg} count={c.ratingCount} size={14} />
        {c.instructor && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={c.instructor.name} uri={c.instructor.avatarUrl} size={32} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary }}>{c.instructor.name}</Text>
              {!!c.instructor.headline && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{c.instructor.headline}</Text>}
            </View>
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {facts.map(f => (
            <View key={f.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Glyph name={f.icon} size={15} color={colors.textMuted} />
              <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{f.text}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

function EnrolledPanel({ progress, title }: { progress: CourseProgress; title: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const completed = progress.status === 'completed'
  const pct = Math.round(progress.progressPercent)

  const certificate = async () => {
    if (!progress.enrollmentId) return
    setBusy(true)
    try {
      await downloadAndShare(certificatePath(progress.enrollmentId), `Certificate - ${title}.pdf`)
    } catch (e) {
      toast(e instanceof Error && !(e as { isAxiosError?: boolean }).isAxiosError ? e.message : errorText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: completed ? colors.successInk : colors.textPrimary }}>
          {completed ? t('catalog.courseComplete') : t('learning.percent', { percent: pct })}
        </Text>
        {completed && <Glyph name="trophy" size={20} color={colors.warning} />}
      </View>
      <ProgressBar percent={pct} />
      {completed && canSaveFiles && !!progress.enrollmentId && (
        <Button variant="ghost" title={t('catalog.certificate')} loading={busy} onPress={() => void certificate()} />
      )}
    </Card>
  )
}

function ExamCard({ courseId, slug }: { courseId: string; slug: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const info = useExamInfo(courseId)
  if (!info.data) return null
  const s = info.data.attempt.status
  const label = s === 'in_progress' ? t('exam.resume') : s === 'submitted' || s === 'suspended' ? t('exam.viewResult') : t('exam.take')
  return (
    <Card onPress={() => router.push({ pathname: '/learning/[slug]/exam', params: { slug, courseId } })} accessibilityLabel={`${info.data.exam.title}. ${label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight }}>
        <Glyph name="ribbon-outline" size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{info.data.exam.title}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
          {t('exam.meta', { count: info.data.exam.questionCount, mins: info.data.exam.durationMinutes })}
        </Text>
      </View>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.primary }}>{label}</Text>
    </Card>
  )
}

function Curriculum({ detail, progress, enrollmentStatus, onOpen }: {
  detail: NonNullable<ReturnType<typeof useCourse>['data']>; progress?: CourseProgress
  enrollmentStatus?: string; onOpen: (l: LessonOutline) => void
}) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const modules = useMemo(() => outlineOf(detail), [detail])
  const done = useMemo(() => new Set(progress?.completedLessons ?? []), [progress])
  if (!modules.length) return <Empty icon="list-outline" title={t('lesson.notFound')} />
  return (
    <View style={{ gap: 18 }}>
      {modules.map((m, mi) => {
        const finished = m.lessons.filter(l => done.has(l.id)).length
        return (
          <View key={m.section.id || `_${mi}`} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <Text accessibilityRole="header" style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1, color: colors.textMuted }}>
                {(m.section.title || t('learning.untitledModule')).toUpperCase()}
              </Text>
              {progress?.isEnrolled && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{`${finished}/${m.lessons.length}`}</Text>}
            </View>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.bgSurface }}>
              {m.lessons.map((l, i) => {
                const gate = lessonGate(l, progress, enrollmentStatus as never)
                const isDone = done.has(l.id)
                return (
                  <Pressable key={l.id} accessibilityRole="button" onPress={() => onOpen(l)}
                    accessibilityLabel={`${l.title}${isDone ? `, ${t('lesson.completed')}` : gate !== 'open' ? `, ${t('status.locked')}` : ''}`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
                      backgroundColor: pressed ? colors.bgMuted : 'transparent', borderTopWidth: i ? 1 : 0, borderTopColor: colors.border })}>
                    <Glyph name={isDone ? 'checkmark-circle' : gate !== 'open' ? 'lock-closed-outline' : TYPE_ICON[l.type] ?? 'ellipse-outline'}
                      size={20} color={isDone ? colors.success : gate !== 'open' ? colors.textMuted : colors.primary} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontFamily: fonts.medium, fontSize: 15, color: gate === 'open' ? colors.textPrimary : colors.textMuted }}>{l.title}</Text>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
                        {[l.durationMins ? t('lesson.minutes', { mins: l.durationMins }) : null, l.isFree && !progress?.isEnrolled ? t('catalog.preview') : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      })}
    </View>
  )
}

function About({ course: c, slug }: { course: CourseSummary; slug: string }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const [wantNotes, setWantNotes] = useState(false)
  const notes = useAiNotes(slug, wantNotes)
  const recs = useRecommendations(slug)
  return (
    <View style={{ gap: 16 }}>
      {c.description
        ? <Text style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: colors.textSecondary }}>{c.description}</Text>
        : <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textMuted }}>{t('catalog.noDescription')}</Text>}
      {!!c.tags?.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {c.tags.map(tag => <Badge key={tag} label={`#${tag}`} tone="muted" />)}
        </View>
      )}

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Glyph name="sparkles" size={18} color={colors.primary} />
          <Text accessibilityRole="header" style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{t('ai.notesTitle')}</Text>
        </View>
        {!wantNotes ? (
          <>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{t('ai.notesBody')}</Text>
            <Button variant="ghost" title={t('ai.notesGenerate')} onPress={() => setWantNotes(true)} />
          </>
        ) : notes.isLoading ? <Loading />
          : notes.error ? <Failed error={notes.error} onRetry={() => void notes.refetch()} />
          : notes.data && (
            <View style={{ gap: 10 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.textSecondary }}>{notes.data.summary}</Text>
              {!!notes.data.keyTakeaways?.length && <Bullets title={t('ai.takeaways')} items={notes.data.keyTakeaways} />}
              {!!notes.data.studyOrder?.length && (
                <Bullets title={t('ai.studyOrder')} items={notes.data.studyOrder.map(s => `${s.title}${s.minutes ? ` (${s.minutes} min)` : ''} — ${s.tip}`)} numbered />
              )}
              {!!notes.data.estimatedStudyTime && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{t('ai.studyTime', { time: notes.data.estimatedStudyTime })}</Text>}
            </View>
          )}
      </Card>

      {!!recs.data?.length && (
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary }}>{t('catalog.related')}</Text>
          {recs.data.slice(0, 4).map(r => (
            <CourseRow key={r.id} course={r} onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: r.slug } })} />
          ))}
        </View>
      )}
    </View>
  )
}

function Bullets({ title, items, numbered }: { title: string; items: string[]; numbered?: boolean }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textPrimary }}>{title}</Text>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary, minWidth: 16 }}>{numbered ? `${i + 1}.` : '•'}</Text>
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{it}</Text>
        </View>
      ))}
    </View>
  )
}

function Reviews({ course: c, slug, canWrite }: { course: CourseSummary; slug: string; canWrite: boolean }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const hist = useRatingHistogram(slug)
  const list = useCourseReviews(c.id)
  /* One vote in flight at a time: a double tap would vote, then un-vote. */
  const [voting, setVoting] = useState<string | null>(null)
  const write = useWriteReview(c.id, slug)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const reviews = list.data?.pages.flatMap(p => p.reviews) ?? []

  const send = () => write.mutate({ rating, comment: comment.trim() || undefined }, {
    onSuccess: () => { toast(t('reviews.thanks')); setRating(0); setComment('') },
    onError: e => toast(errorText(e), 'danger'),
  })

  return (
    <View style={{ gap: 16 }}>
      {hist.data && hist.data.total > 0 && (
        <Card style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text style={{ fontFamily: fonts.display, fontSize: 36, color: colors.textPrimary }}>{hist.data.avg.toFixed(1)}</Text>
            <Stars value={hist.data.avg} size={12} />
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{t('reviews.count', { count: hist.data.total })}</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            {(['5', '4', '3', '2', '1'] as const).map(k => {
              const n = hist.data!.histogram[k] ?? 0
              return (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ width: 10, fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{k}</Text>
                  <View style={{ flex: 1 }}><ProgressBar percent={hist.data!.total ? (n / hist.data!.total) * 100 : 0} tone="primary" /></View>
                </View>
              )
            })}
          </View>
        </Card>
      )}

      {canWrite && (
        <Card style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{t('reviews.write')}</Text>
          <StarInput value={rating} onChange={setRating} />
          <Field label={t('reviews.comment')} value={comment} onChangeText={setComment} maxLength={2000} multiline textAlignVertical="top" style={{ minHeight: 80 }} />
          <Button title={t('reviews.post')} disabled={!rating} loading={write.isPending} onPress={send} />
        </Card>
      )}

      {list.isLoading ? <Loading cards={2} />
        : list.error ? <Failed error={list.error} onRetry={() => void list.refetch()} />
        : reviews.length === 0 ? <Empty icon="chatbubble-ellipses-outline" title={t('reviews.none')} body={canWrite ? t('reviews.beFirst') : undefined} />
        : reviews.map(r => (
          <View key={r.id} style={{ gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar name={r.author?.name ?? '?'} uri={r.author?.avatarUrl} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary }}>{r.author?.name ?? '—'}</Text>
                <Stars value={r.rating} size={11} />
              </View>
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{new Date(r.createdAt).toLocaleDateString()}</Text>
            </View>
            {!!r.comment && <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.textSecondary }}>{r.comment}</Text>}
            {!!r.instructorReply && (
              <View style={{ marginLeft: 12, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: colors.primary, gap: 2 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.primary }}>{t('reviews.reply')}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.textSecondary }}>{r.instructorReply}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <SmallAction icon="thumbs-up-outline" label={r.helpfulVotes ? t('reviews.helpfulN', { count: r.helpfulVotes }) : t('reviews.helpful')}
                onPress={() => {
                  if (voting) return
                  setVoting(r.id)
                  void toggleHelpful(r.id)
                    .then(x => { toast(x.alreadyVoted ? t('reviews.unvoted') : t('reviews.voted'), 'info'); void list.refetch() })
                    .catch(e => toast(errorText(e), 'danger'))
                    .finally(() => setVoting(null))
                }} />
              <SmallAction icon="flag-outline" label={t('reviews.report')}
                onPress={() => Alert.alert(t('reviews.reportTitle'), t('reviews.reportBody'), [
                  { text: t('common.back'), style: 'cancel' },
                  { text: t('reviews.report'), style: 'destructive', onPress: () => void reportReview(r.id).then(() => toast(t('reviews.reported'), 'info')).catch(e => toast(errorText(e), 'danger')) },
                ])} />
            </View>
          </View>
        ))}
      {list.hasNextPage && <Button variant="ghost" title={t('reviews.more')} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} />}
    </View>
  )
}

function SmallAction({ icon, label, onPress }: { icon: React.ComponentProps<typeof Glyph>['name']; label: string; onPress: () => void }) {
  const { colors, fonts } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Glyph name={icon} size={15} color={colors.textMuted} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{label}</Text>
    </Pressable>
  )
}
