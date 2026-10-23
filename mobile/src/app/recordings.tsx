import { useMemo, useState } from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { effCourseTitle, normalizeLiveClass, type LiveClass } from '@shared'
import { apiGet } from '@/lib/http'
import { Card, Glyph, SearchField } from '@/components/ui'
import { fmtWhen } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* Recordings — past classes the student can watch again, newest first.
   (The website's live-classes page has a Recordings tab that is always empty
   — it asks an endpoint that only returns upcoming classes; this asks for the
   ended ones directly.) */
export default function Recordings() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const [q, setQ] = useState('')
  const ended = useQuery({
    queryKey: ['live-classes', 'ended'],
    queryFn: async () => (await apiGet<unknown[]>('/live-classes', { status: 'ended' })).map(normalizeLiveClass),
    staleTime: 60_000,
  })
  const rows = useMemo(() => {
    const withRec = (ended.data ?? []).filter((c: LiveClass) => !!c.recordingUrl)
      .sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart))
    const term = q.trim().toLowerCase()
    return term ? withRec.filter(c => `${c.title} ${effCourseTitle(c) ?? ''}`.toLowerCase().includes(term)) : withRec
  }, [ended.data, q])

  if (ended.isLoading) return <View style={{ padding: 16 }}><Loading cards={4} /></View>
  if (ended.error && !ended.data) return <Failed error={ended.error} onRetry={() => void ended.refetch()} />

  return (
    <FlatList
      data={rows}
      keyExtractor={c => c.id}
      contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={{ marginBottom: 4 }}><SearchField value={q} onChangeText={setQ} placeholder={t('recordings.search')} /></View>}
      refreshControl={<RefreshControl refreshing={ended.isRefetching} onRefresh={() => void ended.refetch()} tintColor={colors.primary} />}
      ListEmptyComponent={<Empty icon="film-outline" title={q ? t('learning.noMatch') : t('recordings.none')} body={q ? undefined : t('recordings.noneBody')} />}
      renderItem={({ item: c }) => (
        <Card onPress={() => router.push({ pathname: '/watch/[id]', params: { id: c.id, recording: '1' } })} accessibilityLabel={`${c.title}, ${fmtWhen(c.scheduledStart)}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight }}>
            <Glyph name="play" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text numberOfLines={2} style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{c.title}</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
              {[fmtWhen(c.scheduledStart), effCourseTitle(c)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Glyph name="chevron-forward" size={16} color={colors.textMuted} />
        </Card>
      )}
    />
  )
}
