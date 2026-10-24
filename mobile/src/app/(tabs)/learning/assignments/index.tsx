import { useState } from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { AssignmentStatus, MyAssignment } from '@shared'
import { useMyAssignments } from '@/lib/api/assignments'
import { fmtWhen } from '@/components/classes'
import { Button } from '@/components/ui'
import { Empty, Failed, Loading } from '@/components/states'
import { useTheme } from '@/theme'

/* The student's class assignments, newest first, with the mentor's verdict —
   and a revision button on the ones sent back. */
export default function Assignments() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const mine = useMyAssignments()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try { await mine.refetch() } finally { setRefreshing(false) }
  }

  if (mine.isLoading) return <Loading />
  if (mine.error && !mine.data) return <Failed error={mine.error} onRetry={() => void refresh()} />

  return (
    <FlatList
      data={mine.data ?? []}
      keyExtractor={a => a.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      ListHeaderComponent={<Button title={t('assignments.submit')} onPress={() => router.push('/learning/assignments/submit')} />}
      ListHeaderComponentStyle={{ marginBottom: 4 }}
      ListEmptyComponent={<Empty icon="document-text-outline" title={t('assignments.none')} body={t('assignments.noneBody')} />}
      renderItem={({ item }) => <AssignmentRow a={item} />}
    />
  )
}

function AssignmentRow({ a }: { a: MyAssignment }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const tone: Record<AssignmentStatus, { fg: string; bg: string }> = {
    pending:  { fg: colors.warningInk, bg: colors.bgMuted },
    approved: { fg: colors.successInk, bg: colors.bgMuted },
    rejected: { fg: colors.danger,  bg: colors.dangerLight },
  }
  const where = [a.liveClass?.title, a.course?.title].filter(Boolean).join(' · ')
  return (
    <View style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{a.title}</Text>
        <Text style={{
          fontFamily: fonts.semibold, fontSize: 12, color: tone[a.status].fg, backgroundColor: tone[a.status].bg,
          paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden',
        }}>{t(`assignments.${a.status}`)}</Text>
      </View>
      {!!where && <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>{where}</Text>}
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>
        {[a.submittedAt ? fmtWhen(a.submittedAt) : null, t('assignments.files', { count: a.files.length }), a.attempt > 1 ? t('assignments.attempt', { n: a.attempt }) : null].filter(Boolean).join(' · ')}
      </Text>
      {a.status === 'rejected' && <>
        {!!a.lastReason && <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.textPrimary }}>{t('assignments.reason', { reason: a.lastReason })}</Text>}
        <Button variant="ghost" title={t('assignments.resubmit')}
          onPress={() => router.push({ pathname: '/learning/assignments/submit', params: { id: a.id } })} />
      </>}
    </View>
  )
}
