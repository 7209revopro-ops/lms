import { Text } from 'react-native'
import { usePreventScreenCapture } from 'expo-screen-capture'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/theme'

/* Paid content protection (plan.md §13.9). On Android, screenshots and screen
   recordings of a guarded screen come out black (FLAG_SECURE); iOS cannot
   block a recording, so the watermark names the account it came from — the
   same deterrent the website uses. */

/** Blocks screen capture while the calling screen is mounted. */
export function useContentGuard(): void {
  usePreventScreenCapture()
}

/** The signed-in student's email, faint, over the video's corner. Place it
 *  inside the video's box (position: relative parent). */
export function Watermark() {
  const { state } = useAuth()
  const { fonts } = useTheme()
  if (state.status !== 'signedIn') return null
  return (
    <Text pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', right: 10, bottom: 34, color: 'rgba(255,255,255,0.35)', fontFamily: fonts.medium, fontSize: 11 }}>
      {state.user.email}
    </Text>
  )
}
