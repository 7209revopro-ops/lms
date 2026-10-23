import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme'
import { Glyph } from './ui'

/* A short confirmation that something happened ("Seat booked") — for news the
   student needs no decision about. Anything they must act on stays an Alert. */

type Tone = 'success' | 'info' | 'danger'
type Toast = { id: number; text: string; tone: Tone }
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {})

export function useToast() { return useContext(Ctx) }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const seq = useRef(0)
  const show = useCallback((text: string, tone: Tone = 'success') => {
    if (tone === 'success') haptic.success()
    else if (tone === 'danger') haptic.warning()
    AccessibilityInfo.announceForAccessibility(text)
    setToast({ id: ++seq.current, text, tone })
  }, [])
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && <ToastView key={toast.id} toast={toast} onDone={() => setToast(t => (t?.id === toast.id ? null : t))} />}
    </Ctx.Provider>
  )
}

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const { colors, fonts, radius } = useTheme()
  const insets = useSafeAreaInsets()
  const [anim] = useState(() => new Animated.Value(0))
  useEffect(() => {
    const run = Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ])
    run.start(({ finished }) => { if (finished) onDone() })
    return () => run.stop()
  }, [anim, onDone])
  const icon = useMemo(() => (toast.tone === 'success' ? 'checkmark-circle' : toast.tone === 'danger' ? 'alert-circle' : 'information-circle'), [toast.tone])
  const tint = toast.tone === 'success' ? colors.success : toast.tone === 'danger' ? colors.danger : colors.primary
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72, opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.md,
        backgroundColor: colors.textPrimary, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        <Glyph name={icon} size={20} color={tint} />
        <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.bgPage }}>{toast.text}</Text>
      </View>
    </Animated.View>
  )
}
