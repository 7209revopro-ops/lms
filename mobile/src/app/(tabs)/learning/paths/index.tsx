import { useMemo, useState } from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useLearningPaths } from '@/lib/api/catalog'
import { Card, Glyph, SearchField } from '@/components/ui'
import { Img } from '@/components/media'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* Learning paths — the website's learning-paths page: a guided order of
   courses towards one goal. */
export default function Paths() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const paths = useLearningPaths()
  const [q, setQ] = useState('')
  /* The website's search on the paths list: title and description. */
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (paths.data ?? []).filter(p => !term || `${p.title} ${p.description ?? ''}`.toLowerCase().includes(term))
  }, [paths.data, q])

  if (paths.isLoading) return <View style={{ padding: 16 }}><Loading cards={3} media /></View>
  if (paths.error && !paths.data) return <Failed error={paths.error} onRetry={() => void paths.refetch()} />

  return (
    <FlatList
      data={rows}
      keyboardShouldPersistTaps="handled"
      keyExtractor={p => p.id}
      contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={paths.isRefetching} onRefresh={() => void paths.refetch()} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{t('paths.intro')}</Text>
          {(paths.data?.length ?? 0) > 3 && <SearchField value={q} onChangeText={setQ} placeholder={t('paths.search')} />}
        </View>
      }
      ListEmptyComponent={q.trim()
        ? <Empty icon="search-outline" title={t('learning.noMatch')} />
        : <Empty icon="git-network-outline" title={t('paths.none')} />}
      renderItem={({ item: p }) => (
        <Card padded={false} onPress={() => router.push({ pathname: '/learning/paths/[slug]', params: { slug: p.slug } })} accessibilityLabel={p.title}>
          <Img cover uri={p.thumbnailUrl} style={{ width: '100%', aspectRatio: 21 / 9 }} placeholderColor={colors.primaryLight} />
          <View style={{ padding: 14, gap: 6 }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{p.title}</Text>
            {!!p.description && <Text numberOfLines={2} style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.textSecondary }}>{p.description}</Text>}
            <View style={{ flexDirection: 'row', gap: 14 }}>
              <Meta icon="layers-outline" text={t('paths.courses', { count: p.courseCount })} />
              {!!p.enrolledCount && <Meta icon="people-outline" text={t('catalog.students', { count: p.enrolledCount })} />}
            </View>
          </View>
        </Card>
      )}
    />
  )
}

function Meta({ icon, text }: { icon: React.ComponentProps<typeof Glyph>['name']; text: string }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Glyph name={icon} size={14} color={colors.textMuted} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{text}</Text>
    </View>
  )
}
