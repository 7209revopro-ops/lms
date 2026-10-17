import { useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { passwordStrength } from '@shared'
import { changePassword, updateName } from '@/lib/api/account'
import { useAuth } from '@/lib/auth'
import { errorText } from '@/lib/errors'
import { Button, Field, Notice, Screen } from '@/components/ui'
import { useTheme } from '@/theme'

/* Your details — the name on the account, and the password. The email is
   changed on the website (it is confirmed through the new mailbox). */
export default function Details() {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { state, refreshUser } = useAuth()
  const user = state.status === 'signedIn' ? state.user : null
  const [name, setName] = useState(user?.name ?? '')
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savingPw, setSavingPw] = useState(false)

  const saveName = async () => {
    setSavingName(true)
    setNameMsg(null)
    try {
      await updateName(name)
      await refreshUser()
      setNameMsg({ ok: true, text: t('account.saved') })
    } catch (e) {
      setNameMsg({ ok: false, text: errorText(e) })
    } finally {
      setSavingName(false)
    }
  }

  const savePassword = async () => {
    setPwMsg(null)
    if (next.length < 8) return setPwMsg({ ok: false, text: t('register.errors.passwordLength') })
    if (!/[A-Z]/.test(next)) return setPwMsg({ ok: false, text: t('register.errors.passwordUpper') })
    if (!/[0-9]/.test(next)) return setPwMsg({ ok: false, text: t('register.errors.passwordNumber') })
    setSavingPw(true)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setPwMsg({ ok: true, text: t('account.passwordChanged') })
    } catch (e) {
      setPwMsg({ ok: false, text: errorText(e) })
    } finally {
      setSavingPw(false)
    }
  }

  if (!user) return null
  const strength = (t('register.strength', { returnObjects: true }) as string[])[passwordStrength(next)]
  return (
    <Screen>
      <Field label={t('register.name')} value={name} onChangeText={setName} maxLength={120} autoComplete="name" />
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textMuted }}>{user.email}</Text>
      {nameMsg && <Notice tone={nameMsg.ok ? 'info' : 'danger'}>{nameMsg.text}</Notice>}
      <Button title={t('account.save')} loading={savingName} disabled={name.trim().length < 2 || name.trim() === user.name} onPress={() => void saveName()} />

      <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
      <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary }}>{t('account.password')}</Text>
      <Field label={t('account.current')} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
      <Field label={t('account.newPassword')} value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      {!!next && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>{strength}</Text>}
      {pwMsg && <Notice tone={pwMsg.ok ? 'info' : 'danger'}>{pwMsg.text}</Notice>}
      <Button title={t('account.password')} loading={savingPw} disabled={!current || !next} onPress={() => void savePassword()} />
    </Screen>
  )
}
