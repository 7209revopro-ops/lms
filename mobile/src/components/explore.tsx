import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { COURSE_SORTS, PROGRAMS, type CourseLevel, type CourseSort } from '@shared'
import { useCatalog } from '@/lib/api/catalog'
import { useMyEnrollments } from '@/lib/api/learning'
import { useTheme } from '@/theme'
import { CourseCard } from './catalog'
import { Empty, Failed, Loading } from './states'
import { Chip, SearchField } from './ui'

/* Explore — the website's course catalogue (courses page + search): search,
   programme pills, level, sort, and an endless list. Enrolled courses say so;
   nothing shows a price (plan.md M6). */

const LEVELS: ('' | CourseLevel)[] = ['', 'beginner', 'intermediate', 'advanced']

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h) }, [value, ms])
  return v
}

export function ExploreCatalog({ header }: { header?: React.ReactElement }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const [search, setSearch] = useState('')
  const [program, setProgram] = useState('')
  const [level, setLevel] = useState<'' | CourseLevel>('')
  const [sort, setSort] = useState<CourseSort>('popular')
  const q = useDebounced(search)
  const query = useMemo(() => ({ search: q, program, level, sort }), [q, program, level, sort])
  const list = useCatalog(query)
  const mine = useMyEnrollments()
  const enrolled = useMemo(() => new Set((mine.data ?? []).map(e => e.course?.id).filter(Boolean) as string[]), [mine.data])
  const courses = useMemo(() => list.data?.pages.flatMap(p => p.courses) ?? [], [list.data])
  const total = list.data?.pages[0]?.meta.total ?? 0

  const filters = (
    <View style={{ gap: 12, marginBottom: 4 }}>
      {header}
      <SearchField value={search} onChangeText={setSearch} placeholder={t('catalog.search')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {PROGRAMS.map(p => <Chip key={p.value} label={p.value ? p.label : t('catalog.allPrograms')} active={program === p.value} onPress={() => setProgram(p.value)} />)}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {LEVELS.map(l => <Chip key={l || 'all'} label={l ? t(`catalog.level.${l}`) : t('catalog.anyLevel')} active={level === l} onPress={() => setLevel(l)} />)}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted }}>
          {list.isSuccess ? t('catalog.results', { count: total }) : ' '}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {COURSE_SORTS.map(s => <Chip key={s} label={t(`catalog.sort.${s}`)} active={sort === s} onPress={() => setSort(s)} />)}
        </View>
      </View>
    </View>
  )

  return (
    <FlatList
      data={courses}
      keyExtractor={c => c.id}
      contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}
      ListHeaderComponent={filters}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={colors.primary} />}
      onEndReachedThreshold={0.6}
      onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage() }}
      ListEmptyComponent={
        list.isLoading ? <Loading cards={3} media />
          : list.error ? <Failed error={list.error} onRetry={() => void list.refetch()} />
          : <Empty icon="search-outline" title={t('catalog.none')} body={t('catalog.noneBody')}
              action={search || program || level ? { label: t('catalog.clear'), onPress: () => { setSearch(''); setProgram(''); setLevel('') } } : undefined} />
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} /> : undefined}
      renderItem={({ item }) => (
        <CourseCard course={item} enrolled={enrolled.has(item.id)}
          onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: item.slug } })} />
      )}
    />
  )
}
