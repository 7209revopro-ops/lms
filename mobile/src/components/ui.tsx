import { forwardRef, type ComponentRef, type ReactNode } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput,
  View, type TextInputProps,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '@/theme'

/* The handful of building blocks P0 needs, styled from the theme. */

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const { colors, space } = useTheme()
  const body = scroll
    ? <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, flexGrow: 1 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={{ flex: 1, padding: space.xl, gap: space.lg }}>{children}</View>
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPage }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
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
  title: string; onPress: () => void; loading?: boolean; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean
}) {
  const { colors, fonts, radius } = useTheme()
  const primary = variant !== 'ghost'
  const off = disabled || loading
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress} disabled={off}
      style={({ pressed }) => [styles.button, {
        borderRadius: radius.md,
        backgroundColor: !primary ? 'transparent' : variant === 'danger' ? colors.danger : pressed ? colors.primaryPressed : colors.primary,
        opacity: off ? 0.6 : variant === 'danger' && pressed ? 0.85 : 1,
      }]}>
      {loading
        ? <ActivityIndicator color={primary ? colors.onPrimary : colors.primary} />
        : <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: primary ? colors.onPrimary : colors.primary }}>{title}</Text>}
    </Pressable>
  )
}

export type FieldRef = ComponentRef<typeof TextInput>

export const Field = forwardRef<FieldRef, TextInputProps & { label: string }>(function Field({ label, style, ...props }, ref) {
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
          backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1,
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
})

/** A filter pill — one of a row of choices. */
export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors, fonts } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
        borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primaryLight : colors.bgSurface }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: active ? colors.primary : colors.textSecondary }}>{label}</Text>
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
