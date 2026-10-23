import { useState } from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { PendingRating } from '@shared'
import { usePendingRatings, useRateInstructor } from '@/lib/api/engage'
import { errorText } from '@/lib/errors'
import { Button, Card, Field } from '@/components/ui'
import { StarInput } from '@/components/catalog'
import { fmtWhen } from '@/components/classes'
import { Empty, Failed, Loading } from '@/components/states'
import { useToast } from '@/components/toast'
import { useTheme } from '@/theme'

/* Rate your classes — the website's "Rate classes" page: every class the
   student attended and has not rated yet, each rated once (stars and an
   optional comment for the mentor). */
export default function RateClasses() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const list = usePendingRatings()
  if (list.isLoading) return <View style={{ padding: 16 }}><Loading cards={2} /></View>
  if (list.error && !list.data) return <Failed error={list.error} onRetry={() => void list.refetch()} />
  return (
    <FlatList
      data={list.data ?? []}
      keyExtractor={r => r.liveClassId}
      contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={colors.primary} />}
      ListEmptyComponent={<Empty icon="star-outline" title={t('rate.none')} body={t('rate.noneBody')} />}
      renderItem={({ item }) => <RateCard r={item} />}
    />
  )
}

function RateCard({ r }: { r: PendingRating }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const rate = useRateInstructor()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ gap: 3 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{r.title}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>
          {[fmtWhen(r.scheduledStart), r.courseTitle].filter(Boolean).join(' · ')}
        </Text>
        <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{t('classes.mentor', { name: r.instructorName })}</Text>
      </View>
      <StarInput value={rating} onChange={setRating} />
      {/* The comment and the send button appear once a star is chosen. */}
      {rating > 0 && <>
      <Field label={t('rate.comment')} value={comment} onChangeText={setComment} maxLength={2000} multiline textAlignVertical="top" style={{ minHeight: 72 }} />
      <Button title={t('rate.send')} disabled={!rating} loading={rate.isPending}
        onPress={() => rate.mutate({ liveClassId: r.liveClassId, rating, comment: comment.trim() || undefined }, {
          onSuccess: () => toast(t('rate.thanks')),
          onError: e => toast(errorText(e), 'danger'),
        })} />
      </>}
    </Card>
  )
}
