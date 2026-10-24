import { useMemo } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useLearningPath } from '@/lib/api/catalog'
import { useMyEnrollments } from '@/lib/api/learning'
import { Badge, Glyph } from '@/components/ui'
import { CourseRow } from '@/components/catalog'
import { Img } from '@/components/media'
import { Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* One learning path: its goal, then the courses in order. Unlike the website
   (which greys out every step after the first prerequisite), steps use the
   student's own progress: done, in progress, or next. */
export default function PathDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const path = useLearningPath(slug)
  const mine = useMyEnrollments()
  const progress = useMemo(() => new Map((mine.data ?? []).filter(e => e.course).map(e => [e.course!.id, e])), [mine.data])

  if (path.isLoading) return <Loading />
  if (path.error || !path.data) return <Failed error={path.error} onRetry={() => void path.refetch()} />
  const p = path.data
  const doneCount = p.steps.filter(s => progress.get(s.course.id)?.status === 'completed').length

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Stack.Screen options={{ title: p.title }} />
      <Img cover uri={p.thumbnailUrl} style={{ width: '100%', aspectRatio: 21 / 9 }} placeholderColor={colors.primaryLight} />
      <View style={{ padding: 16, gap: 12 }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.textPrimary }}>{p.title}</Text>
        {!!p.description && <Text style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.textSecondary }}>{p.description}</Text>}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Badge label={t('paths.courses', { count: p.steps.length })} icon="layers-outline" tone="muted" />
          <Badge label={t('paths.doneOf', { done: doneCount, total: p.steps.length })} icon="checkmark-done-outline" tone={doneCount === p.steps.length && p.steps.length ? 'success' : 'primary'} />
        </View>
        <View style={{ gap: 10, marginTop: 4 }}>
          {p.steps.map((s, i) => {
            const e = progress.get(s.course.id)
            const done = e?.status === 'completed'
            return (
              <View key={s.course.id} style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ alignItems: 'center', width: 28 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: done ? colors.success : e ? colors.primaryFill : colors.bgMuted }}>
                    {done ? <Glyph name="checkmark" size={16} color="#fff" />
                      : <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: e ? '#fff' : colors.textSecondary }}>{i + 1}</Text>}
                  </View>
                  {i < p.steps.length - 1 && <View style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: done ? colors.success : colors.border }} />}
                </View>
                <View style={{ flex: 1, gap: 6, paddingBottom: 6 }}>
                  {s.isPrerequisite && <Badge label={t('paths.prerequisite')} tone="warning" />}
                  <CourseRow course={s.course} onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: s.course.slug } })}
                    right={e ? <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: done ? colors.successInk : colors.primary }}>{done ? t('learning.completed') : `${Math.round(e.progressPercent)}%`}</Text> : undefined} />
                </View>
              </View>
            )
          })}
        </View>
      </View>
    </ScrollView>
  )
}
