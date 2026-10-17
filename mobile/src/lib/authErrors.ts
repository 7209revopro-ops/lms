import { router } from 'expo-router'
import { isDeviceCode, problemOf } from '@shared'
import type { TFunction } from 'i18next'
import { NotAStudentError } from './auth'

/* What a sign-in screen shows when sign-in fails. A device refusal is not a
   line of red text — it gets its own screen with what to do next. Returns the
   message to show, or null when it navigated instead. */
export function handleSignInError(err: unknown, t: TFunction): string | null {
  if (err instanceof NotAStudentError) return t('auth.studentsOnly')
  const p = problemOf(err)
  if (p.kind === 'offline') return t('common.offline')
  if (p.kind === 'timeout') return t('common.timeout')
  if (isDeviceCode(p.code)) {
    router.push({ pathname: '/(auth)/device', params: { code: p.code, message: p.message } })
    return null
  }
  /* The server's sentences are written for students already. */
  return p.message
}
