import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { AndroidImportance } from 'expo-notifications'
import { appPathFor } from '@shared'
import { appVersion } from './device'
import { http } from './http'
import { clearPushToken, readPushToken, writePushToken } from './secureStore'

/* ─────────────────────────────────────────────────────────────
   Push notifications (plan.md §13.8). The server pushes every in-app
   notification to the phones the student is signed in on; this file asks
   for permission, registers the phone, unregisters it on sign-out, and turns
   a tapped notification into a screen.
───────────────────────────────────────────────────────────── */

/* Shown even while the app is open — a reply arriving while the student is
   on another tab should still be seen. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})

export type PushOutcome = 'registered' | 'denied' | 'unavailable'

/** The EAS project id — Expo issues push tokens per project. Absent until
 *  the project is linked (`eas init`); push then stays off, quietly. */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined
}

/** Ask (once — the OS remembers a refusal) and register this phone. Safe to
 *  call on every launch: the server upserts by token. Never throws. */
export async function registerForPush(): Promise<PushOutcome> {
  try {
    const id = projectId()
    if (!id) return 'unavailable'
    if (Platform.OS === 'android') {
      /* The server sends on channel 'default'; Android 8+ needs it to exist
         before anything can be shown. */
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Classes and messages',
        importance: AndroidImportance.HIGH,
      })
    }
    let perm = await Notifications.getPermissionsAsync()
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync()
    if (!perm.granted) return 'denied'

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id })
    await http.post('/push-tokens', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android', appVersion })
    await writePushToken(token)
    return 'registered'
  } catch {
    /* Offline, or Expo unreachable: try again on the next launch. */
    return 'unavailable'
  }
}

/** Stop pushes to this phone. Needs no session (the server takes the token as
 *  proof), so it works after a session has already died. Never throws. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = await readPushToken()
    if (!token) return
    await clearPushToken()
    await http.delete('/push-tokens', { data: { token } })
  } catch { /* best effort */ }
}

/** The screen a tapped notification opens; its website link mapped to the
 *  app, else the notification list. */
export function screenForNotification(response: Notifications.NotificationResponse): string {
  const link = (response.notification.request.content.data as { link?: unknown } | undefined)?.link
  return (typeof link === 'string' && appPathFor(link)) || '/notifications'
}
