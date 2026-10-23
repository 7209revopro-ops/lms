import * as Haptics from 'expo-haptics'

/* Light, meaningful vibration — on a choice, a success, a refusal. Never on
   every tap. expo-haptics looks its native module up optionally, so on a build
   without it these simply do nothing; errors are swallowed for the same reason
   (a phone with haptics switched off rejects the call). */
const quietly = (p: Promise<void>) => { p.catch(() => {}) }

export const haptic = {
  /** A selection changed: a chip, a tab, a radio. */
  select: () => quietly(Haptics.selectionAsync()),
  /** A light physical confirmation of a press that starts something. */
  tap: () => quietly(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Something worked: booked, submitted, completed. */
  success: () => quietly(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Refused or failed. */
  warning: () => quietly(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
}
