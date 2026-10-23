import { Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { GENERAL_MODULE_ID } from '@shared'
import { moduleIdOf, useCatalog } from '@/lib/catalog'
import { Empty, Failed, Loading } from '@/components/states'
import { ModuleHero, SessionsBoard } from '@/components/schedule'

/* A module, as the website's module sheet: its banner and counts, then every
   session still ahead, by day, with the Language / Instructor / Mode filter.
   One seat per weekly slot and one per hybrid class — the server enforces
   both; the cards only say so first. */
export default function ModuleSessions() {
  const { courseId, moduleId } = useLocalSearchParams<{ courseId: string; moduleId: string }>()
  const { t } = useTranslation()
  const { catalog, bookingMap, isLoading, error, refreshing, refresh } = useCatalog()

  const course = catalog.find(c => (c.id || '_none') === courseId)
  const module = course?.modules.find(m => m.id === moduleIdOf(moduleId ?? ''))

  if (isLoading) return <Loading />
  if (!course || !module) return error ? <Failed error={error} onRetry={refresh} /> : <Empty icon="calendar-outline" title={t('schedule.moduleEmpty')} />

  const ordered = course.modules.filter(m => m.id !== GENERAL_MODULE_ID)
  const position = module.id === GENERAL_MODULE_ID ? null : (module.number ?? ordered.indexOf(module) + 1)
  return (
    <>
      <Stack.Screen options={{ title: course.title }} />
      <SessionsBoard groups={module.groups} bookingMap={bookingMap} blocked={module.blocked} resetKey={module.id}
        refreshing={refreshing} onRefresh={refresh}
        header={<ModuleHero node={module} position={position} courseTitle={course.title} />} />
    </>
  )
}
