import { FlatList, RefreshControl, Text, View } from 'react-native'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useTranslation } from 'react-i18next'
import { useMyOrders, type MyOrder } from '@/lib/api/account'
import { Badge, Button, Card } from '@/components/ui'
import { Img } from '@/components/media'
import { Empty, Failed, Loading } from '@/components/states'
import { fmtShort } from '@/components/classes'
import { useTheme } from '@/theme'

/* Purchases — the website's Orders page: what was bought, when, for how much,
   and the invoice when the gateway issued one. A record, not a shop: buying
   stays off the app (plan.md M6). */
export default function Purchases() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const orders = useMyOrders()

  if (orders.isLoading) return <View style={{ padding: 16 }}><Loading cards={3} /></View>
  if (orders.error && !orders.data) return <Failed error={orders.error} onRetry={() => void orders.refetch()} />

  return (
    <FlatList
      data={orders.data ?? []}
      keyExtractor={o => o.id}
      contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} tintColor={colors.primary} />}
      ListEmptyComponent={<Empty icon="receipt-outline" title={t('account.purchasesNone')} body={t('account.purchasesNoneBody')} />}
      renderItem={({ item }) => <OrderCard o={item} />}
    />
  )
}

const TONE = { paid: 'success', pending: 'warning', refunded: 'muted', cancelled: 'danger' } as const

function money(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

function OrderCard({ o }: { o: MyOrder }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const known = o.status in TONE ? (o.status as keyof typeof TONE) : null
  const course = o.courseId
  return (
    <Card onPress={course?.slug ? () => router.push({ pathname: '/learning/[slug]', params: { slug: course.slug } }, { withAnchor: true }) : undefined}
      accessibilityLabel={course?.title} style={{ flexDirection: 'row', gap: 12 }}>
      <Img cover uri={course?.thumbnailUrl} style={{ width: 64, height: 64, borderRadius: radius.md }} placeholderColor={colors.bgMuted} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text numberOfLines={2} style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>{course?.title ?? '—'}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{fmtShort(o.createdAt)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Badge label={t(`account.orderStatus.${known ?? 'unknown'}`)} tone={known ? TONE[known] : 'muted'} />
          <View style={{ alignItems: 'flex-end' }}>
            {!!o.discountAmount && (
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, textDecorationLine: 'line-through' }}>
                {money(o.amount + o.discountAmount, o.currency)}
              </Text>
            )}
            <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{money(o.amount, o.currency)}</Text>
          </View>
        </View>
        {!!o.stripeInvoiceUrl && (
          <Button variant="ghost" title={t('account.invoice')} onPress={() => void WebBrowser.openBrowserAsync(o.stripeInvoiceUrl!)} />
        )}
      </View>
    </Card>
  )
}
