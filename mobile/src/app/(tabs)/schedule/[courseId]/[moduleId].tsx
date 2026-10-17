import { useMemo, useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import {
  filterGroups, moduleFacets, showFacet, slotPattern, type SessionMode,
} from '@shared'
import { useTranslation } from 'react-i18next'
import { moduleIdOf, useCatalog } from '@/lib/catalog'
import { ClassCard } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { Chip } from '@/components/ui'
import { useNow } from '@/hooks/useNow'
import { useTheme } from '@/theme'

/* A module's weekly slots, each with its sessions and the one action the
   student can take on each. One seat per weekly slot, and one per hybrid
   class — the server enforces both; the cards only say so first. */
export default function ModuleSessions() {
  const { courseId, moduleId } = useLocalSearchParams<{ courseId: string; moduleId: string }>()
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { catalog, bookingMap, isLoading, error, refreshing, refresh } = useCatalog()
  const [mode, setMode] = useState<SessionMode | null>(null)
  const [language, setLanguage] = useState<string | null>(null)

  const course = catalog.find(c => (c.id || '_none') === courseId)
  const module = course?.modules.find(m => m.id === moduleIdOf(moduleId ?? ''))
  const facets = useMemo(() => (module ? moduleFacets(module.groups) : null), [module])
  const groups = useMemo(() => (module ? filterGroups(module.groups, language, null, mode) : []), [module, language, mode])
  const now = useNow(useMemo(() => groups.flatMap(g => g.slots), [groups]))

  if (isLoading) return <Loading />
  if (!module) return error ? <Failed error={error} onRetry={refresh} /> : <Empty title={t('schedule.moduleEmpty')} />

  return (
    <>
      <Stack.Screen options={{ title: module.title }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        {facets && (showFacet(facets.modes) || showFacet(facets.languages)) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {showFacet(facets.modes) && <>
              <Chip label={t('schedule.all')} active={!mode} onPress={() => setMode(null)} />
              <Chip label={t('schedule.online')} active={mode === 'online'} onPress={() => setMode('online')} />
              <Chip label={t('schedule.inPerson')} active={mode === 'offline'} onPress={() => setMode('offline')} />
            </>}
            {showFacet(facets.languages) && facets.languages.map(l => (
              <Chip key={l} label={l} active={language === l} onPress={() => setLanguage(language === l ? null : l)} />
            ))}
          </View>
        )}

        {groups.length === 0 && <Empty title={t('schedule.noMatch')} />}

        {groups.map(g => {
          const pattern = slotPattern(g.slots)
          return (
            <View key={g.id} style={{ gap: 10 }}>
              <View style={{ gap: 2 }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>
                  {pattern ? t('schedule.weekly', { weekday: pattern.weekday, time: pattern.time }) : g.title}
                </Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>
                  {[g.instructor?.name, (g.slots[0] as { language?: string } | undefined)?.language, `${g.slots.length} session${g.slots.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {g.slots.map(lc => {
                const held = g.bookedSlot
                const hasOther = !!held && held.id !== lc.id
                const heldTwin = hasOther && held?.hybridPairId && held.hybridPairId === lc.hybridPairId ? held : undefined
                return (
                  <ClassCard key={lc.id} lc={lc} booking={bookingMap.get(lc.id)} hasOther={hasOther} heldTwin={heldTwin}
                    now={now} onPress={() => router.push(`/class/${lc.id}`)} />
                )
              })}
            </View>
          )
        })}
      </ScrollView>
    </>
  )
}
