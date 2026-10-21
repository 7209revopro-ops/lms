import { Text } from 'react-native'
import { useEffect, useId } from 'react'
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/theme'

/* Paid content protection (plan.md §13.9). On Android, screenshots and screen
   recordings of a guarded screen come out black (FLAG_SECURE); iOS cannot
   block a recording, so the watermark names the account it came from — the
   same deterrent the website uses. */

/** Blocks screen capture while the calling screen is mounted — in preview
 *  and production builds. A development build leaves capture on, or the
 *  screens it guards could not be screenshotted or inspected while testing
 *  (verified on the first device run: with the guard, `adb screencap` of a
 *  lesson is solid black). Each screen holds its own key, so closing one
 *  guarded screen never unblocks another still open beneath it. */
export function useContentGuard(): void {
  const key = useId()
  useEffect(() => {
    if (__DEV__) return
    void preventScreenCaptureAsync(key)
    return () => { void allowScreenCaptureAsync(key) }
  }, [key])
}

/** The signed-in student's email, faint, in the video's top corner — clear of
 *  the native controls (at the bottom it covered the settings button). Place it
 *  inside the video's box (position: relative parent). */
export function Watermark() {
  const { state } = useAuth()
  const { fonts } = useTheme()
  if (state.status !== 'signedIn') return null
  return (
    <Text pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', right: 10, top: 10, color: 'rgba(255,255,255,0.35)', fontFamily: fonts.medium, fontSize: 11 }}>
      {state.user.email}
    </Text>
  )
}
