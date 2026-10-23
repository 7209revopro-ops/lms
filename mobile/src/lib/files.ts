import { requireOptionalNativeModule } from 'expo'
import { env } from './env'
import { http, session } from './http'

/* Saving a file the server makes for this student (a certificate PDF) and
   handing it to the phone's share sheet — save to Files, send on WhatsApp,
   print. expo-file-system and expo-sharing are native: a build made before
   they were added has neither, and the caller hides the button. */

export const canSaveFiles = !!requireOptionalNativeModule('FileSystem') && !!requireOptionalNativeModule('ExpoSharing')

/** Download an authenticated API file to the cache and open the share sheet. */
export async function downloadAndShare(apiPath: string, fileName: string, mimeType = 'application/pdf'): Promise<void> {
  if (!canSaveFiles) throw new Error('This build cannot save files. Update the app.')
  /* The download bypasses the HTTP client, so make sure the access token is
     fresh first — this request refreshes it if it had expired. */
  await http.get('/auth/me')
  const token = session.accessToken()
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- only once this build is known to have the native module
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- only once this build is known to have the native module
  const Sharing = require('expo-sharing') as typeof import('expo-sharing')
  const target = new File(Paths.cache, fileName.replace(/[^\w.-]+/g, '_'))
  const file = await File.downloadFileAsync(`${env.apiUrl}${apiPath}`, target, {
    headers: token ? { Authorization: `Bearer ${token}`, 'X-Client': 'mobile' } : { 'X-Client': 'mobile' },
    idempotent: true,
  })
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: fileName, UTI: 'com.adobe.pdf' })
}

/** Copy text, if this build has the clipboard module. Returns whether it did. */
export async function copyText(text: string): Promise<boolean> {
  if (!requireOptionalNativeModule('ExpoClipboard')) return false
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- only once this build is known to have the native module
  const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard')
  await Clipboard.setStringAsync(text)
  return true
}
