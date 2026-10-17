import { appPathFor } from '@shared'

/* Every link that opens the app passes through here first (Expo Router's
   native intent). A website link — a Universal / App Link such as the
   WhatsApp Join button, or deltalms://… — is mapped to the app's screen by
   the same rule push notifications use (shared/src/links.ts). Must never
   throw: an exception here crashes the app on launch. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const mapped = appPathFor(path)
    if (mapped) return mapped
    /* A website page the app does not have: Home, not "page not found". */
    if (/^https?:/i.test(path)) return '/'
    return path
  } catch {
    return path
  }
}
