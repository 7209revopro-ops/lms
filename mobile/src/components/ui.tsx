import { Children, forwardRef, useContext, useEffect, useState, type ComponentProps, type ComponentRef, type ReactNode } from 'react'
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput,
  View, type DimensionValue, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { HeaderHeightContext } from 'expo-router/react-navigation'
import Ionicons from '@expo/vector-icons/Ionicons'
import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme'
import { Img } from './media'

/* The handful of building blocks P0 needs, styled from the theme. */

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const { colors, space } = useTheme()
  /* Under a navigator header: the header already clears the status bar, and
     the keyboard is measured from below it. 0 / undefined when there is none. */
  const headerHeight = useContext(HeaderHeightContext) ?? 0
  const body = scroll
    ? <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, flexGrow: 1 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={{ flex: 1, padding: space.xl, gap: space.lg }}>{children}</View>
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPage }} edges={headerHeight ? ['left', 'right', 'bottom'] : undefined}>
      {/* 'padding' on Android too: the app draws edge to edge, so the window no
          longer shrinks for the keyboard and nothing else lifts the fields. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/* A decorative icon inside a button or card. Hidden from screen readers:
   Android otherwise reads its font glyph into the label of the button around
   it ("Basics, , 4 weekly slots"). Not for an icon that is the only meaning —
   give that one its own accessibilityLabel instead. */
export function Glyph(props: ComponentProps<typeof Ionicons>) {
  return <View importantForAccessibility="no-hide-descendants"><Ionicons {...props} /></View>
}

export function Title({ children }: { children: ReactNode }) {
  const { colors, fonts } = useTheme()
  return <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 28, color: colors.textPrimary }}>{children}</Text>
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const { colors, fonts } = useTheme()
  return <Text style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: muted ? colors.textMuted : colors.textSecondary }}>{children}</Text>
}

export function Button({ title, onPress, loading, variant = 'primary', disabled }: {
  title: string; onPress: () => void; loading?: boolean; variant?: 'primary' | 'ghost' | 'danger' | 'dangerGhost'; disabled?: boolean
}) {
  const { colors, fonts, radius } = useTheme()
  const primary = variant === 'primary' || variant === 'danger'
  /* The colour of a ghost button's label and spinner. */
  const ink = variant === 'dangerGhost' ? colors.danger : colors.primary
  const off = disabled || loading
  return (
    /* Labelled with its title: while loading only a spinner is inside, and
       Android otherwise keeps announcing "busy" after it is done. */
    <Pressable
      accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress} disabled={off}
      style={({ pressed }) => [styles.button, {
        borderRadius: radius.md,
        backgroundColor: !primary ? 'transparent' : variant === 'danger' ? colors.danger : pressed ? colors.primaryPressed : colors.primaryFill,
        opacity: off ? 0.6 : variant === 'danger' && pressed ? 0.85 : 1,
      }]}>
      {loading
        ? <ActivityIndicator color={primary ? colors.onPrimary : ink} />
        : <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: primary ? colors.onPrimary : ink }}>{title}</Text>}
    </Pressable>
  )
}

export type FieldRef = ComponentRef<typeof TextInput>

/* `invalid` draws the red border the form pickers (Select, DateField) draw. */
export const Field = forwardRef<FieldRef, TextInputProps & { label: string; invalid?: boolean }>(function Field({ label, invalid, style, ...props }, ref) {
  const { colors, fonts, radius } = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        style={[{
          fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary,
          backgroundColor: colors.bgSurface, borderColor: invalid ? colors.danger : colors.border, borderWidth: 1,
          borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
        }, style]}
        {...props}
      />
    </View>
  )
})

export function Notice({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'info' }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <View accessibilityRole="alert" style={{
      borderRadius: radius.md, padding: 12,
      backgroundColor: tone === 'danger' ? colors.dangerLight : colors.primaryLight,
    }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: tone === 'danger' ? colors.danger : colors.primary }}>{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: { minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  lifted: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
})

/** A filter pill — one of a row of choices. */
export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors, fonts } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} hitSlop={6}
      style={{ paddingHorizontal: 14, paddingVertical: 7, minHeight: 36, justifyContent: 'center', borderRadius: 999, borderWidth: 1,
        borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primaryLight : colors.bgSurface }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: active ? colors.primary : colors.textSecondary }}>{label}</Text>
    </Pressable>
  )
}

/** A surface that can be pressed: shrinks a touch while held, so every card
    in the app answers a finger the same way. Not pressable without onPress. */
export function Card({ children, onPress, style, accessibilityLabel, accessibilityHint, padded = true }: {
  children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>
  accessibilityLabel?: string; accessibilityHint?: string; padded?: boolean
}) {
  const { colors, radius } = useTheme()
  const surface: ViewStyle = {
    backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg,
    padding: padded ? 16 : 0, overflow: 'hidden',
  }
  if (!onPress) return <View style={[surface, style]}>{children}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}
      style={({ pressed }) => [surface, style, pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 }]}>
      {children}
    </Pressable>
  )
}

/** A placeholder block that breathes while content loads — the shape of what
    is coming, so the screen does not jump when it arrives. */
export function Skeleton({ width = '100%', height = 14, radius: r = 6, style }: {
  width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle>
}) {
  const { colors } = useTheme()
  const [pulse] = useState(() => new Animated.Value(0.55))
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [pulse])
  return <Animated.View accessible={false} style={[{ width, height, borderRadius: r, backgroundColor: colors.bgMuted, opacity: pulse }, style]} />
}

/** A stack of card-shaped skeletons — the loading state of a list. */
export function SkeletonCards({ count = 3, media = false }: { count?: number; media?: boolean }) {
  const { colors, radius } = useTheme()
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading" style={{ gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 10 }}>
          {media && <Skeleton height={140} radius={radius.md} />}
          <Skeleton width="45%" height={12} />
          <Skeleton width="85%" height={18} />
          <Skeleton width="60%" height={12} />
        </View>
      ))}
    </View>
  )
}

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'muted'

/** A small coloured label: a status, a level, a count. */
export function Badge({ label, tone = 'primary', icon, solid }: {
  label: string; tone?: Tone; icon?: ComponentProps<typeof Ionicons>['name']
  /** Over a photo: an opaque chip with white text, readable on any picture. */
  solid?: boolean
}) {
  const { colors, fonts } = useTheme()
  const tint = tone === 'muted' ? colors.textSecondary : tone === 'primary' ? colors.primaryFill : colors[tone]
  /* As text, green and amber take their ink: the bright fills are ~2:1 on white. */
  const fg = solid ? '#FFFFFF' : tone === 'muted' ? colors.textSecondary
    : tone === 'success' ? colors.successInk : tone === 'warning' ? colors.warningInk : colors[tone]
  const bg = solid ? (tone === 'success' ? '#059669' : tint) : tone === 'muted' ? colors.bgMuted : `${fg}1F`
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3,
      borderRadius: 999, backgroundColor: bg }}>
      {icon && <Glyph name={icon} size={12} color={fg} />}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: fg }}>{label}</Text>
    </View>
  )
}

/* Mid-tone hues: readable as text on their own 16% tint in light and dark. */
const AVATAR_HUES = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1']

/** A round picture of a person, or their initials when there is none. */
export function Avatar({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number }) {
  const { colors, fonts } = useTheme()
  /* Letters and digits only: "[QA] Reviewer One" reads QR, not "[R". */
  const initials = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
  if (uri) return <Img uri={uri} style={{ width: size, height: size, borderRadius: size / 2 }} placeholderColor={colors.primaryLight} />
  /* One stable colour per person, so a list of mentors is told apart at a glance. */
  const hue = AVATAR_HUES[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % AVATAR_HUES.length]!
  return (
    <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${hue}29`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: size * 0.38, color: hue }}>{initials}</Text>
    </View>
  )
}

/** Two to four mutually exclusive views of one screen ("My courses | Explore"). */
export function Segmented<T extends string>({ options, value, onChange }: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 3, gap: 3, borderRadius: radius.md, backgroundColor: colors.bgMuted }}>
      {options.map(o => {
        const on = o.value === value
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            onPress={() => { if (!on) { haptic.select(); onChange(o.value) } }}
            style={{ flex: 1, paddingVertical: 9, borderRadius: radius.md - 3, alignItems: 'center',
              backgroundColor: on ? colors.bgSurface : 'transparent', ...(on ? styles.lifted : null) }}>
            <Text style={{ fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 14, color: on ? colors.textPrimary : colors.textSecondary }}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** A search box with its icon and a clear button. */
export function SearchField({ value, onChangeText, placeholder, autoFocus }: { value: string; onChangeText: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: radius.md,
      backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.border }}>
      <Glyph name="search" size={18} color={colors.textMuted} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textMuted}
        accessibilityLabel={placeholder} autoFocus={autoFocus} returnKeyType="search" autoCorrect={false}
        style={{ flex: 1, paddingVertical: 11, fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary }} />
      {!!value && (
        <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  )
}

/** One row of a settings-style list: icon, label, optional detail, chevron. */
export function ListRow({ icon, label, detail, onPress, danger, right }: {
  icon?: ComponentProps<typeof Ionicons>['name']; label: string; detail?: string; onPress?: () => void; danger?: boolean; right?: ReactNode
}) {
  const { colors, fonts } = useTheme()
  const body = (
    <>
      {icon && (
        <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? colors.dangerLight : colors.primaryLight }}>
          <Glyph name={icon} size={18} color={danger ? colors.danger : colors.primary} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 15, color: danger ? colors.danger : colors.textPrimary }}>{label}</Text>
        {!!detail && <Text style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.textMuted }}>{detail}</Text>}
      </View>
      {right ?? (onPress && <Glyph name="chevron-forward" size={16} color={colors.textMuted} />)}
    </>
  )
  const row: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 }
  if (!onPress) return <View style={row}>{body}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={detail ? `${label}. ${detail}` : label}
      style={({ pressed }) => [row, { backgroundColor: pressed ? colors.bgMuted : 'transparent' }]}>
      {body}
    </Pressable>
  )
}

/** A rounded box of ListRows with hairlines between them. */
export function Group({ children, title }: { children: ReactNode; title?: string }) {
  const { colors, fonts, radius } = useTheme()
  const rows = Children.toArray(children).filter(Boolean)
  return (
    <View style={{ gap: 8 }}>
      {title && <Text accessibilityRole="header" style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.8, color: colors.textMuted, marginLeft: 4 }}>{title.toUpperCase()}</Text>}
      <View style={{ backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <View key={i}>
            {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 }} />}
            {r}
          </View>
        ))}
      </View>
    </View>
  )
}

/** A round icon-only button. The label is required — it is all a screen reader has. */
export function IconButton({ icon, label, onPress, color, size = 22, active }: {
  icon: ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; color?: string; size?: number; active?: boolean
}) {
  const { colors } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={active === undefined ? undefined : { selected: active }} hitSlop={8}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.bgMuted : 'transparent' })}>
      <Ionicons name={icon} size={size} color={color ?? colors.textPrimary} />
    </Pressable>
  )
}

/** A thin completion bar, 0–100. */
export function ProgressBar({ percent, tone = 'success' }: { percent: number; tone?: 'success' | 'primary' }) {
  const { colors } = useTheme()
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: p }}
      style={{ height: 6, borderRadius: 3, backgroundColor: colors.bgMuted, overflow: 'hidden' }}>
      <View style={{ width: `${p}%`, height: '100%', backgroundColor: tone === 'success' ? colors.success : colors.primary }} />
    </View>
  )
}

const NOTIFICATION_ICONS: Record<string, ComponentProps<typeof Glyph>['name']> = {
  'enrollment': 'school', 'lesson-complete': 'checkmark-circle', 'course-complete': 'ribbon',
  'review-posted': 'star', 'live-class-scheduled': 'calendar', 'achievement': 'trophy',
  'booking-confirmed': 'checkmark-done', 'booking-cancelled': 'close-circle', 'class-reminder': 'alarm',
  'mentor-no-show': 'alert-circle', 'support-ticket-raised': 'help-buoy',
  'instructor-review-requested': 'star-half', 'chat-message': 'chatbubble',
}

/** The glyph for a notification's kind — the same on Home and in the list. */
export function notificationIcon(kind: string): ComponentProps<typeof Glyph>['name'] {
  return NOTIFICATION_ICONS[kind] ?? 'notifications'
}
