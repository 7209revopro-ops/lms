import { ActivityIndicator, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { errorText } from '@/lib/errors'
import { Button } from './ui'
import { useTheme } from '@/theme'

/* Loading, failed and empty — three different things, never drawn the same.
   (A failed fetch that renders like "nothing here" is the class-schedule
   silent-error bug the website already had once.) */

export function Loading() {
  const { colors } = useTheme()
  return <View style={{ paddingVertical: 48, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
}

export function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  return (
    <View style={{ paddingVertical: 32, gap: 12, alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 15, color: colors.danger, textAlign: 'center' }}>{errorText(error)}</Text>
      <Button variant="ghost" title={t('common.tryAgain')} onPress={onRetry} />
    </View>
  )
}

export function Empty({ title, body }: { title: string; body?: string }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ paddingVertical: 40, gap: 6, alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.textPrimary, textAlign: 'center' }}>{title}</Text>
      {body && <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>{body}</Text>}
    </View>
  )
}
