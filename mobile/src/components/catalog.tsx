import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { compactCount, durationLabel, RATING_WORDS, type CourseSummary } from '@shared'
import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme'
import { Img } from './media'
import { Badge, Card, Glyph } from './ui'

/* Course cards, stars — the catalogue's building blocks. No prices, ever. */

/** Read-only stars, e.g. 4.6 ★★★★½ (2,134). */
export function Stars({ value, count, size = 13 }: { value?: number; count?: number; size?: number }) {
  const { colors, fonts } = useTheme()
  if (!value) return null
  const full = Math.floor(value), half = value - full >= 0.5
  return (
    <View accessible accessibilityLabel={`Rated ${value.toFixed(1)} out of 5${count ? `, ${count} ratings` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: size, color: colors.warning }}>{value.toFixed(1)}</Text>
      <View style={{ flexDirection: 'row' }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Glyph key={i} name={i <= full ? 'star' : i === full + 1 && half ? 'star-half' : 'star-outline'} size={size} color={colors.warning} />
        ))}
      </View>
      {!!count && <Text style={{ fontFamily: fonts.body, fontSize: size - 1, color: colors.textMuted }}>({compactCount(count)})</Text>}
    </View>
  )
}

/** Tap-to-rate, 1–5, with the website's words under it. */
export function StarInput({ value, onChange, size = 34 }: { value: number; onChange: (v: number) => void; size?: number }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ gap: 6, alignItems: 'center' }}>
      <View accessibilityRole="adjustable" accessibilityLabel="Rating" accessibilityValue={{ min: 0, max: 5, now: value, text: value ? `${value} — ${RATING_WORDS[value]}` : 'Not rated' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => onChange(Math.max(1, Math.min(5, value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
        style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Pressable key={i} hitSlop={4} importantForAccessibility="no" onPress={() => { haptic.select(); onChange(i) }}>
            <Glyph name={i <= value ? 'star' : 'star-outline'} size={size} color={i <= value ? colors.warning : colors.borderStrong} />
          </Pressable>
        ))}
      </View>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: value ? colors.textSecondary : colors.textMuted, minHeight: 18 }}>
        {value ? RATING_WORDS[value] : ' '}
      </Text>
    </View>
  )
}

const LEVEL = { beginner: 'success', intermediate: 'warning', advanced: 'danger' } as const

/** A full-width catalogue card: cover, level, title, instructor, rating, length. */
export function CourseCard({ course, onPress, enrolled }: { course: CourseSummary; onPress: () => void; enrolled?: boolean }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const dur = durationLabel(course.durationMins)
  return (
    <Card onPress={onPress} padded={false} accessibilityLabel={`${course.title}${course.instructor ? `, ${course.instructor.name}` : ''}`}>
      <View>
        <Img cover uri={course.thumbnailUrl} style={{ width: '100%', aspectRatio: 16 / 9 }} placeholderColor={colors.primaryLight} />
        <View style={{ position: 'absolute', left: 10, top: 10, flexDirection: 'row', gap: 6 }}>
          {enrolled && <Badge label={t('catalog.enrolled')} tone="success" icon="checkmark-circle" solid />}
          {course.isFree && !enrolled && <Badge label={t('catalog.free')} tone="primary" solid />}
        </View>
        {!!dur && (
          <View style={{ position: 'absolute', right: 10, bottom: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: 'rgba(0,0,0,0.65)' }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: '#fff' }}>{dur}</Text>
          </View>
        )}
      </View>
      <View style={{ padding: 14, gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {course.category && <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.primary }}>{course.category.name.toUpperCase()}</Text>}
          {course.level && <Badge label={t(`catalog.level.${course.level}`)} tone={LEVEL[course.level]} />}
        </View>
        <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.textPrimary }}>{course.title}</Text>
        {course.instructor && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>{course.instructor.name}</Text>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Stars value={course.ratingAvg} count={course.ratingCount} />
          {!!course.enrolledCount && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Glyph name="people-outline" size={13} color={colors.textMuted} />
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{t('catalog.students', { count: course.enrolledCount })}</Text>
            </View>
          )}
        </View>
      </View>
    </Card>
  )
}

/** A compact row — lists inside a page (recommendations, favourites, a path). */
export function CourseRow({ course, onPress, leading, right }: { course: CourseSummary; onPress: () => void; leading?: React.ReactNode; right?: React.ReactNode }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <Card onPress={onPress} accessibilityLabel={course.title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
      {leading}
      <Img cover uri={course.thumbnailUrl} style={{ width: 72, height: 54, borderRadius: radius.sm }} placeholderColor={colors.primaryLight} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text numberOfLines={2} style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.textPrimary }}>{course.title}</Text>
        <Stars value={course.ratingAvg} count={course.ratingCount} size={12} />
      </View>
      {right ?? <Glyph name="chevron-forward" size={16} color={colors.textMuted} />}
    </Card>
  )
}
