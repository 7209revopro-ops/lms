import type { ComponentProps } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { errorText } from '@/lib/errors'
import { Button, Glyph, SkeletonCards } from './ui'
import { useTheme } from '@/theme'

/* Loading, failed and empty — three different things, never drawn the same.
   (A failed fetch that renders like "nothing here" is the class-schedule
   silent-error bug the website already had once.) */

/** Loading. `cards` shows the shape of a list instead of a spinner. */
export function Loading({ cards, media }: { cards?: number; media?: boolean } = {}) {
  const { colors } = useTheme()
  if (cards) return <SkeletonCards count={cards} media={media} />
  return <View accessibilityRole="progressbar" accessibilityLabel="Loading" style={{ paddingVertical: 48, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
}

export function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  return (
    <View style={{ paddingVertical: 32, gap: 12, alignItems: 'center' }}>
      <Glyph name="cloud-offline-outline" size={36} color={colors.textMuted} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 15, color: colors.danger, textAlign: 'center' }}>{errorText(error)}</Text>
      <Button variant="ghost" title={t('common.tryAgain')} onPress={onRetry} />
    </View>
  )
}

export function Empty({ title, body, icon, action, compact }: {
  title: string; body?: string; icon?: ComponentProps<typeof Ionicons>['name']
  /** A way forward from the empty screen ("Browse courses"). */
  action?: { label: string; onPress: () => void }
  /** Inside a card: tighter, a smaller icon. */
  compact?: boolean
}) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ paddingVertical: compact ? 8 : 40, paddingHorizontal: 16, gap: compact ? 4 : 8, alignItems: 'center' }}>
      {icon && (
        <View style={{ width: compact ? 48 : 64, height: compact ? 48 : 64, borderRadius: 32, marginBottom: compact ? 4 : 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight }}>
          <Glyph name={icon} size={compact ? 22 : 28} color={colors.primary} />
        </View>
      )}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.textPrimary, textAlign: 'center' }}>{title}</Text>
      {body && <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: 'center' }}>{body}</Text>}
      {action && <View style={{ marginTop: 8, alignSelf: 'stretch' }}><Button variant="ghost" title={action.label} onPress={action.onPress} /></View>}
    </View>
  )
}
