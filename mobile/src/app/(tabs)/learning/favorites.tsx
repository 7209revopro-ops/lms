import { FlatList, RefreshControl } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useFavorites, useToggleFavorite } from '@/lib/api/catalog'
import { haptic } from '@/lib/haptics'
import type { CourseSummary } from '@shared'
import { CourseRow } from '@/components/catalog'
import { IconButton } from '@/components/ui'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* Saved courses — the website's favourites: courses kept for later, with
   the heart to let one go. */
export default function Favorites() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const list = useFavorites()
  if (list.isLoading) return <Loading cards={4} />
  if (list.error && !list.data) return <Failed error={list.error} onRetry={() => void list.refetch()} />
  return (
    <FlatList
      data={list.data ?? []}
      keyExtractor={c => c.id}
      contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={colors.primary} />}
      ListEmptyComponent={<Empty icon="heart-outline" title={t('favorites.none')} body={t('favorites.noneBody')} />}
      renderItem={({ item }) => <Row course={item} />}
    />
  )
}

function Row({ course }: { course: CourseSummary }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const toggle = useToggleFavorite(course)
  return (
    <CourseRow course={course} onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: course.slug } })}
      right={<IconButton icon="heart" color={colors.danger} label={t('favorites.remove')} onPress={() => { haptic.tap(); toggle.mutate(false) }} />} />
  )
}
