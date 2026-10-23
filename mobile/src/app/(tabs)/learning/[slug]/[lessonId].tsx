import { useCallback, useMemo, useRef } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { lessonGate, lessonSequence, type LessonGate, type LessonOutline } from '@shared'
import { useCourse, useCourseProgress, useMarkComplete } from '@/lib/api/learning'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { ArticleView, LessonVideo, type PlayerHandle } from '@/components/lesson'
import { LessonExtras } from '@/components/lessonExtras'
import { QuizPlayer } from '@/components/QuizPlayer'
import { useContentGuard } from '@/components/protected'
import { Button, Notice, Glyph } from '@/components/ui'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* One lesson: the video, article or quiz; Mark complete (& next);
   Previous / Next across modules; and the student's private note.
   Screen capture is blocked for as long as a lesson is open. */
export default function Lesson() {
  const { slug, lessonId } = useLocalSearchParams<{ slug: string; lessonId: string }>()
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { state } = useAuth()
  const headerHeight = useHeaderHeight()
  useContentGuard()
  /* The playing video, for bookmarks (set by LessonVideo once it has a player). */
  const playerRef = useRef<PlayerHandle | null>(null)
  const onPlayer = useCallback((h: PlayerHandle | null) => { playerRef.current = h }, [])

  const enrollmentStatus = state.status === 'signedIn' ? state.user.enrollmentStatus : undefined
  const course = useCourse(slug)
  const progress = useCourseProgress(slug, enrollmentStatus !== 'pending')
  const complete = useMarkComplete(slug!)

  const seq = useMemo(() => (course.data ? lessonSequence(course.data) : []), [course.data])
  const idx = seq.findIndex(l => l.id === lessonId)
  const lesson = idx >= 0 ? seq[idx] : undefined
  const prev = idx > 0 ? seq[idx - 1] : undefined
  const next = idx >= 0 && idx < seq.length - 1 ? seq[idx + 1] : undefined

  if (course.isLoading || (progress.isLoading && enrollmentStatus !== 'pending')) return <Loading />
  if (course.error || !course.data) return <Failed error={course.error} onRetry={() => void course.refetch()} />
  if (!lesson) return <Empty title={t('lesson.notFound')} />

  /* Replace rather than push, so Back returns to the course, not through
     every lesson read on the way. */
  const go = (l: LessonOutline) => router.replace({ pathname: '/learning/[slug]/[lessonId]', params: { slug: slug!, lessonId: l.id } })
  const gate = lessonGate(lesson, progress.data, enrollmentStatus)
  const isDone = !!progress.data?.completedLessons.includes(lesson.id)
  const canTrack = gate === 'open' && !!progress.data?.isEnrolled

  return (
    <>
      <Stack.Screen options={{ title: course.data.course.title }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {gate !== 'open'
            ? <Locked gate={gate} />
            : lesson.type === 'video'
              ? <LessonVideo key={lesson.id} lesson={lesson} onPlayer={onPlayer} />
              : lesson.type === 'article'
                ? <ArticleView lesson={lesson} />
                : <View style={{ padding: 16 }}><QuizPlayer key={lesson.id} lessonId={lesson.id} onNext={next ? () => go(next) : undefined} /></View>}

          <View style={{ padding: 16, gap: 14 }}>
            <View style={{ gap: 4 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1, color: colors.textMuted }}>
                {t('lesson.of', { n: idx + 1, total: seq.length }).toUpperCase()}
              </Text>
              <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 22, color: colors.textPrimary }}>{lesson.title}</Text>
              {lesson.durationMins > 0 && (
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{t('lesson.minutes', { mins: lesson.durationMins })}</Text>
              )}
            </View>

            {canTrack && (isDone ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.success }}>{t('lesson.completed')}</Text>
              </View>
            ) : (
              <Button title={next ? t('lesson.completeNext') : t('lesson.complete')} loading={complete.isPending}
                onPress={() => complete.mutate(lesson.id, { onSuccess: () => { if (next) go(next) } })} />
            ))}
            {complete.error && <Notice>{`${t('lesson.completeFailed')}: ${errorText(complete.error)}`}</Notice>}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <NavButton label={t('lesson.previous')} icon="chevron-back" onPress={prev ? () => go(prev) : undefined} />
              <NavButton label={t('lesson.next')} icon="chevron-forward" trailing onPress={next ? () => go(next) : undefined} />
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel={t('ai.askTutor')}
              onPress={() => router.push({ pathname: '/tutor', params: { courseSlug: slug!, lessonId: lesson.id, title: lesson.title } })}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.lg,
                backgroundColor: pressed ? colors.primaryLight : colors.bgSurface, borderWidth: 1, borderColor: colors.border })}>
              <Glyph name="sparkles" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{t('ai.askTutor')}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{t('ai.askTutorBody')}</Text>
              </View>
              <Glyph name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>

            {canTrack && <LessonExtras key={lesson.id} lessonId={lesson.id} isVideo={lesson.type === 'video'} player={() => playerRef.current} />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  )
}

function Locked({ gate }: { gate: Exclude<LessonGate, 'open'> }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const text = gate === 'pending' ? t('lesson.lockedPending') : gate === 'notEnrolled' ? t('lesson.lockedEnroll') : t('lesson.lockedModule')
  return (
    <View style={{ aspectRatio: 16 / 9, backgroundColor: colors.bgMuted, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 }}>
      <Ionicons name="lock-closed" size={28} color={colors.textMuted} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 15, textAlign: 'center', color: colors.textSecondary }}>{text}</Text>
    </View>
  )
}

function NavButton({ label, icon, onPress, trailing }: {
  label: string; icon: 'chevron-back' | 'chevron-forward'; onPress?: () => void; trailing?: boolean
}) {
  const { colors, fonts, radius } = useTheme()
  const off = !onPress
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: off }} disabled={off} onPress={onPress}
      style={({ pressed }) => ({
        flex: 1, flexDirection: trailing ? 'row-reverse' : 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
        minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
        backgroundColor: pressed ? colors.bgMuted : colors.bgSurface, opacity: off ? 0.4 : 1,
      })}>
      <Glyph name={icon} size={18} color={colors.primary} />
      <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.primary }}>{label}</Text>
    </Pressable>
  )
}
