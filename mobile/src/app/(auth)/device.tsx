import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Body, Button, Screen, Title } from '@/components/ui'

/* A device refusal (DEVICE_PENDING / DEVICE_LIMIT / DEVICE_REVOKED) — the
   admin approves phones on the Devices page, same as browsers. The server's
   own sentence explains limit and revoked; pending gets the friendlier
   version with what to do next. */
export default function DeviceRefused() {
  const { t } = useTranslation()
  const { code, message } = useLocalSearchParams<{ code: string; message: string }>()
  const title = code === 'DEVICE_LIMIT' ? t('device.limitTitle') : code === 'DEVICE_REVOKED' ? t('device.revokedTitle') : t('device.pendingTitle')
  const body = code === 'DEVICE_PENDING' ? t('device.pendingBody') : (message ?? '')
  return (
    <Screen scroll={false}>
      <Title>{title}</Title>
      <Body>{body}</Body>
      {code === 'DEVICE_PENDING' && <Button title={t('device.checkAgain')} onPress={() => router.back()} />}
      {code !== 'DEVICE_PENDING' && <Button variant="ghost" title={t('common.back')} onPress={() => router.back()} />}
    </Screen>
  )
}
