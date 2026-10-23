import { useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { levelHeld, unlockRequest, type JourneyLevel } from '@shared'
import { useJourney } from '@/lib/api/engage'
import { useCreateTicket } from '@/lib/api/support'
import { errorText } from '@/lib/errors'
import { Badge, Button, Card, Glyph, ProgressBar } from '@/components/ui'
import { Img } from '@/components/media'
import { Empty, Failed, Loading } from '@/components/states'
import { useToast } from '@/components/toast'
import { useTheme } from '@/theme'

/* Your journey — the website's Class Schedule journey (2026-10-21): each
   programme's courses as levels. A level you hold opens its classes; one you
   do not explains why it is closed and lets you ask your advisor to open it
   (a support request, as on the website). The app never sells — no Buy. */
export default function JourneyScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const j = useJourney()
  const [open, setOpen] = useState<{ level: JourneyLevel; programme: string } | null>(null)

  if (j.isLoading) return <View style={{ padding: 16 }}><Loading cards={3} /></View>
  if (j.error && !j.data) return <Failed error={j.error} onRetry={() => void j.refetch()} />
  const programmes = (j.data?.programmes ?? []).filter(p => p.levels.length)

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 22, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={j.isRefetching} onRefresh={() => void j.refetch()} tintColor={colors.primary} />}>
      {!programmes.length && <Empty icon="trail-sign-outline" title={t('journey.none')} body={t('journey.noneBody')} />}
      {programmes.map(p => (
        <View key={p.program} style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 22, color: colors.textPrimary }}>{p.label}</Text>
          {p.levels.map((l, i) => (
            <LevelRow key={l.courseId} level={l} last={i === p.levels.length - 1}
              onPress={() => (levelHeld(l)
                ? router.push({ pathname: '/schedule/[courseId]', params: { courseId: l.courseId } })
                : setOpen(open?.level.courseId === l.courseId ? null : { level: l, programme: p.label }))} />
          ))}
          {open && p.levels.some(l => l.courseId === open.level.courseId) && (
            <UnlockCard level={open.level} programme={open.programme} advisor={j.data?.advisor?.name} onClose={() => setOpen(null)} />
          )}
        </View>
      ))}
    </ScrollView>
  )
}

const STATE_ICON = { completed: 'checkmark', current: 'play', next: 'arrow-forward', locked: 'lock-closed' } as const

function LevelRow({ level: l, last, onPress }: { level: JourneyLevel; last: boolean; onPress: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const held = levelHeld(l)
  const dot = l.state === 'completed' ? colors.success : l.state === 'current' ? colors.primaryFill : l.state === 'next' ? colors.warning : colors.bgMuted
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ alignItems: 'center', width: 32 }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: dot }}>
          <Glyph name={STATE_ICON[l.state]} size={15} color={l.state === 'locked' ? colors.textMuted : '#fff'} />
        </View>
        {!last && <View style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: l.state === 'completed' ? colors.success : colors.border }} />}
      </View>
      <Card onPress={onPress} accessibilityLabel={`${t('journey.level', { n: l.level })}: ${l.title}. ${t(`journey.state.${l.state}`)}`}
        style={{ flex: 1, marginBottom: last ? 0 : 6, flexDirection: 'row', gap: 12, padding: 12, opacity: l.state === 'locked' ? 0.82 : 1 }}>
        <Img cover uri={l.thumbnailUrl} style={{ width: 60, height: 60, borderRadius: radius.md }} placeholderColor={colors.primaryLight} />
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.8, color: colors.textMuted }}>{t('journey.level', { n: l.level }).toUpperCase()}</Text>
            <Badge label={t(`journey.state.${l.state}`)} tone={l.state === 'completed' ? 'success' : l.state === 'current' ? 'primary' : l.state === 'next' ? 'warning' : 'muted'} />
          </View>
          <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{l.title}</Text>
          {held ? (
            <>
              <ProgressBar percent={l.progressPercent} />
              <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary }}>
                {t('journey.heldMeta', { pct: Math.round(l.progressPercent), open: l.modulesOpen, total: l.modulesTotal, count: l.classesAttended })}
              </Text>
            </>
          ) : (
            <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{t('journey.modules', { count: l.modulesTotal })}</Text>
          )}
        </View>
        <Glyph name={held ? 'chevron-forward' : 'information-circle-outline'} size={18} color={colors.textMuted} />
      </Card>
    </View>
  )
}

function UnlockCard({ level: l, programme, advisor, onClose }: { level: JourneyLevel; programme: string; advisor?: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const toast = useToast()
  const ask = useCreateTicket()
  const [sent, setSent] = useState(false)
  const send = () => Alert.alert(t('journey.askTitle'), t('journey.askBody', { title: l.title }), [
    { text: t('common.back'), style: 'cancel' },
    { text: t('journey.ask'), onPress: () => ask.mutate(unlockRequest(l, programme), {
      onSuccess: () => { setSent(true); toast(t('journey.asked')) },
      onError: e => toast(errorText(e), 'danger'),
    }) },
  ])
  return (
    <Card style={{ gap: 10, borderColor: colors.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Glyph name="lock-open-outline" size={20} color={colors.primary} />
        <Text accessibilityRole="header" style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary }}>{l.title}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('home.dismiss')} hitSlop={10}>
          <Glyph name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
      {!!l.description && <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{l.description}</Text>}
      <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.textSecondary }}>
        {l.state === 'next' ? t('journey.nextBody') : l.lockReason === 'payment' ? t('journey.lockedPayment') : t('journey.lockedBody')}
      </Text>
      {!!advisor && <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textPrimary }}>{t('journey.advisor', { name: advisor })}</Text>}
      {sent
        ? <Badge label={t('journey.asked')} tone="success" icon="checkmark-circle" />
        : <Button title={t('journey.ask')} loading={ask.isPending} onPress={send} />}
      {!!l.slug && <Button variant="ghost" title={t('journey.seeCourse')} onPress={() => router.push({ pathname: '/learning/[slug]', params: { slug: l.slug! } }, { withAnchor: true })} />}
    </Card>
  )
}
