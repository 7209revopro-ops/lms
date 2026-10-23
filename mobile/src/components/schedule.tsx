import { useMemo, useState, type ReactNode } from 'react'
import {
  Modal, Pressable, RefreshControl, ScrollView, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import {
  displayStatus, filterGroups, getSlotStatus, groupByDay, moduleFacets, programName, seatsLeft, showFacet,
  type ClassGroup, type CourseNode, type DayBucket, type JourneyLevel, type LiveClass, type ModuleNode,
  type MyBooking, type SessionMode, type SlotStatus,
} from '@shared'
import { useAuth } from '@/lib/auth'
import { useNow } from '@/hooks/useNow'
import { Gradient, Img } from './media'
import { Avatar, Glyph } from './ui'
import { ClassAction, StatusPill, fmtTime } from './classes'
import { Empty } from './states'
import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme'

/* ─────────────────────────────────────────────────────────────
   The Class Schedule, as the website draws it (client class-bookings/
   Hierarchy.tsx): courses → modules → the module's dated sessions, with the
   day strip and the Language / Instructor / Mode filter. The rules are the
   shared ones (buildCatalog, moduleFacets, filterGroups, groupByDay,
   getSlotStatus), so the app and the site always offer the same seats.
───────────────────────────────────────────────────────────── */

/* ── Module art: the website's moduleSkin, so a module wears the same colour
      in both places. FNV-1a over id·title; the hue ring starts per course. ── */

function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/* Six stops with Delta's 212 in the set (website HUES). */
const HUES: [number, number][] = [[196, 62], [204, 74], [212, 88], [220, 74], [228, 62], [188, 56]]

export interface Skin { from: string; to: string; tint: string; variant: number; tilt: number; ax: number }

export function skinOf(id: string, title: string, position: number | null, courseTitle: string): Skin {
  const h = hash(`${id}·${title.trim().toLowerCase()}`)
  const ring = hash(courseTitle || 'delta')
  const bit = (shift: number, n: number) => ((h >>> shift) & 0x1f) % n
  const pos = position ?? 0
  const [hue, sat] = HUES[(ring + pos * 5) % HUES.length]!
  return {
    from: `hsl(${hue}, ${sat}%, 30%)`,
    to: `hsl(${(hue + 18) % 360}, ${sat + 4}%, 18%)`,
    tint: `hsl(${hue}, 92%, 76%)`,
    variant: (bit(5, 4) + pos) % 4,
    tilt: -16 + bit(10, 5) * 8,
    ax: 0.29 + bit(15, 5) * 0.14,
  }
}

/** A delta — the one shape the banners are drawn with. `size` is its side. */
function Delta({ x, y, size, color, opacity, rotate }: { x: number; y: number; size: number; color: string; opacity: number; rotate: number }) {
  const h = size * 0.866
  return (
    <View style={{
      position: 'absolute', left: x - size / 2, top: y - h / 2, width: 0, height: 0, opacity,
      borderLeftWidth: size / 2, borderRightWidth: size / 2, borderBottomWidth: h,
      borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color,
      transform: [{ rotate: `${rotate}deg` }],
    }} />
  )
}

/** The gradient wash and its geometry; children sit on top. */
export function ModuleArt({ skin, style, children, muted }: { skin: Skin; style?: StyleProp<ViewStyle>; children?: ReactNode; muted?: boolean }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout
    if (!box || box.w !== w || box.h !== h) setBox({ w, h })
  }
  const { variant, tilt, tint } = skin
  const art = box && (() => {
    const { w, h } = box
    const ax = w * skin.ax, u = Math.max(w, h * 1.6)
    switch (variant) {
      case 0: return [1, 0.7, 0.45, 0.24].map((sc, i) => (
        <Delta key={i} x={ax} y={h * 0.55} size={u * 0.62 * sc} color={tint} opacity={0.07 + i * 0.03} rotate={tilt} />
      ))
      case 1: return [0, 1, 2, 3, 4].map(i => (
        <Delta key={i} x={ax - u * 0.25 + i * u * 0.15} y={h * (0.15 + i * 0.18)} size={u * 0.16} color={tint} opacity={0.08 + i * 0.05} rotate={tilt + i * 12} />
      ))
      case 2: {
        const step = Math.max(26, u * 0.14), out: ReactNode[] = []
        for (let r = 0; r * step < h + step; r++) for (let c = 0; c * step < w + step; c++) {
          out.push(<Delta key={`${r}-${c}`} x={c * step + (r % 2) * step / 2} y={r * step} size={step * 0.55} color={tint} opacity={0.16} rotate={tilt} />)
        }
        return out
      }
      default: return [
        <Delta key="a" x={ax} y={h * 0.48} size={u * 0.66} color={tint} opacity={0.11} rotate={tilt} />,
        <Delta key="b" x={ax - u * 0.22} y={h * 0.75} size={u * 0.3} color={tint} opacity={0.16} rotate={tilt + 180} />,
      ]
    }
  })()
  return (
    <View onLayout={onLayout} style={[{ overflow: 'hidden' }, style, muted && { opacity: 0.55 }]}>
      <Gradient colors={muted ? ['#4B5563', '#1F2937'] : [skin.from, skin.to]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {box && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          {/* one light source, on every card */}
          <View style={{ position: 'absolute', left: box.w * skin.ax - box.h * 0.7, top: -box.h * 0.35, width: box.h * 1.4, height: box.h * 1.4,
            borderRadius: box.h * 0.7, backgroundColor: tint, opacity: 0.12 }} />
          {art}
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: tint, opacity: 0.35 }} />
        </View>
      )}
      {children}
    </View>
  )
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "Today, 5:30 PM" / "Tomorrow, 6:30 PM" / "Sat 24 Oct, 4:30 PM". */
function whenLabel(ms: number, t: (k: string) => string): string {
  const d = new Date(ms), today = new Date(), tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  const time = fmtTime(d.toISOString())
  const day = d.toDateString() === today.toDateString() ? t('schedule.today')
    : d.toDateString() === tomorrow.toDateString() ? t('schedule.tomorrow')
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day}, ${time}`
}

/* ── Level 1: a course ──────────────────────────────────────────── */

export function CourseCard({ node, journey, onPress }: { node: CourseNode; journey?: JourneyLevel; onPress: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const [failed, setFailed] = useState(false)
  const skin = useMemo(() => skinOf(node.id, node.title, hash(node.id || node.title) % 6, node.program ?? 'delta'), [node.id, node.title, node.program])
  const empty = node.sessionCount === 0
  /* The journey knows how many of ALL the course's modules are open; the
     catalogue only knows the modules that have classes. */
  const open = journey?.modulesTotal ? journey.modulesOpen : node.modules.filter(m => !m.blocked).length
  const total = journey?.modulesTotal ? journey.modulesTotal : node.modules.length

  const now = useNow()
  const { next, week } = useMemo(() => {
    const weekEnd = now + 7 * 86_400_000
    let next: number | null = null, week = 0
    for (const m of node.modules) for (const g of m.groups) for (const lc of g.slots) {
      const at = new Date(lc.scheduledStart).getTime()
      if (!Number.isFinite(at) || at < now - 2 * 3_600_000) continue
      if (at <= weekEnd) week++
      if (!m.blocked && (next === null || at < next)) next = at
    }
    return { next, week }
  }, [node.modules, now])
  const nextLabel = next === null ? null : whenLabel(next, t)
  const programme = node.program ? programName(node.program) : null

  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={[node.title, `${open} / ${total} ${t('schedule.modulesOpen')}`, nextLabel && t('schedule.nextClass', { when: nextLabel })].filter(Boolean).join(', ')}
      style={({ pressed }) => ({
        borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.border,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}>
      <ModuleArt skin={skin} style={{ aspectRatio: 16 / 7 }}>
        {node.thumbnailUrl && !failed && (
          <Img uri={node.thumbnailUrl} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onError={() => setFailed(true)} />
        )}
        <View style={{ position: 'absolute', left: 12, right: 12, top: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.95)' }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: '#0C447C' }}>
              {empty ? t('schedule.noSessions') : week ? t('schedule.thisWeek', { count: week }) : t('schedule.sessionCount', { count: node.sessionCount })}
            </Text>
          </View>
          {journey ? (
            <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#0ECC8E' }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: '#04342C' }}>{t('schedule.level', { n: journey.level })}</Text>
            </View>
          ) : null}
        </View>
      </ModuleArt>

      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ gap: 3 }}>
          <Text numberOfLines={2} style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: colors.textPrimary }}>{node.title}</Text>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>
            {[t('schedule.modules', { count: total }), programme].filter(Boolean).join(' · ')}
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary }}>{t('schedule.modulesOpen')}</Text>
            <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.textPrimary }}>{`${open}/${total}`}</Text>
          </View>
          <View style={{ height: 7, borderRadius: 4, backgroundColor: colors.bgMuted, overflow: 'hidden' }}>
            <View style={{ width: `${total ? Math.round((open / total) * 100) : 0}%`, height: '100%', borderRadius: 4, backgroundColor: colors.primaryFill }} />
          </View>
        </View>

        {nextLabel && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.primaryLight }}>
            <Glyph name="time-outline" size={16} color={colors.primary} />
            <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 13, color: colors.textPrimary }}>{t('schedule.nextClass', { when: nextLabel })}</Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.md, paddingVertical: 13,
          backgroundColor: empty ? colors.bgMuted : colors.primaryFill }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: empty ? colors.textMuted : '#FFFFFF' }}>
            {empty ? t('schedule.nothingScheduled') : t('schedule.viewModules')}
          </Text>
          {!empty && <Glyph name="chevron-forward" size={16} color="#FFFFFF" />}
        </View>
      </View>
    </Pressable>
  )
}

/* ── Level 2: a module ──────────────────────────────────────────── */

export function ModuleCard({ node, position, courseTitle, onPress }: { node: ModuleNode; position: number | null; courseTitle: string; onPress: () => void }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const skin = useMemo(() => skinOf(node.id, node.title, position, courseTitle), [node.id, node.title, position, courseTitle])
  const locked = node.blocked
  const empty = node.sessionCount === 0
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${node.title}, ${t('schedule.sessionCount', { count: node.sessionCount })}${locked ? `, ${t('schedule.locked')}` : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.lg,
        backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.border, transform: [{ scale: pressed ? 0.985 : 1 }],
      })}>
      <ModuleArt skin={skin} muted={locked} style={{ width: 58, height: 58, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 8.5, letterSpacing: 1.2, color: 'rgba(255,255,255,0.85)' }}>
          {position !== null ? t('schedule.moduleShort') : t('schedule.tileMore')}
        </Text>
        <Text style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 25, color: '#FFFFFF' }}>{position !== null ? pad2(position) : '·'}</Text>
      </ModuleArt>

      <View style={{ flex: 1, gap: 5 }}>
        <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.textPrimary }}>{node.title}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 3 }}>
          {locked && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Glyph name="lock-closed" size={12} color={colors.warning} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.warning }}>{t('schedule.locked')}</Text>
            </View>
          )}
          <Meta icon="calendar-outline" text={empty ? t('schedule.nothingScheduled') : t('schedule.sessionCount', { count: node.sessionCount })} />
          {node.languages.length > 0 && <Meta icon="globe-outline" text={node.languages.join(', ')} />}
        </View>
      </View>

      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
        backgroundColor: locked || empty ? colors.bgMuted : colors.primaryFill }}>
        <Glyph name={locked ? 'lock-closed' : 'chevron-forward'} size={16} color={locked || empty ? colors.textMuted : '#FFFFFF'} />
      </View>
    </Pressable>
  )
}

function Meta({ icon, text }: { icon: 'calendar-outline' | 'globe-outline' | 'time-outline' | 'location-outline' | 'videocam-outline'; text: string }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
      <Glyph name={icon} size={12} color={colors.textMuted} />
      <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary, flexShrink: 1 }}>{text}</Text>
    </View>
  )
}

/* ── Level 3: the module's header ───────────────────────────────── */

export function ModuleHero({ node, position, courseTitle }: { node: ModuleNode; position: number | null; courseTitle: string }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const skin = useMemo(() => skinOf(node.id, node.title, position, courseTitle), [node.id, node.title, position, courseTitle])
  const now = useNow()
  const soonest = useMemo(() => {
    let best: LiveClass | undefined
    for (const g of node.groups) for (const lc of g.slots) {
      if (!isAheadAt(lc, now)) continue
      if (!best || lc.scheduledStart < best.scheduledStart) best = lc
    }
    return best
  }, [node.groups, now])

  return (
    <View style={{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.border }}>
      <ModuleArt skin={skin} muted={node.blocked} style={{ height: 136 }}>
        <Gradient colors={['rgba(2,6,16,0)', 'rgba(2,6,16,0.55)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 100 }} />
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 14, flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
          <View>
            <Text style={{ fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.8, color: 'rgba(255,255,255,0.75)' }}>
              {position !== null ? t('schedule.moduleShort') : t('schedule.tileSessions')}
            </Text>
            {position !== null ? (
              <Text style={{ fontFamily: fonts.display, fontSize: 46, lineHeight: 50, color: 'rgba(255,255,255,0.96)' }}>{pad2(position)}</Text>
            ) : (
              <View style={{ marginTop: 6, width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }}>
                <Glyph name="calendar-outline" size={22} color="rgba(255,255,255,0.92)" />
              </View>
            )}
          </View>
          <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.display, fontSize: 19, lineHeight: 24, color: '#FFFFFF', marginBottom: 4 }}>{node.title}</Text>
        </View>
        {node.blocked && (
          <View style={{ position: 'absolute', right: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999,
            paddingHorizontal: 9, paddingVertical: 3, backgroundColor: 'rgba(15,23,42,0.55)' }}>
            <Glyph name="lock-closed" size={10} color="#FFFFFF" />
            <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: '#FFFFFF' }}>{t('schedule.locked')}</Text>
          </View>
        )}
      </ModuleArt>

      <View style={{ padding: 14, gap: 12 }}>
        {!!node.description && <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.textSecondary }}>{node.description}</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Stat accent icon="calendar-outline" value={String(node.sessionCount)} label={t('schedule.statSessions', { count: node.sessionCount })} />
          <Stat icon="globe-outline" value={String(node.languages.length)} label={t('schedule.statLanguages', { count: node.languages.length })} />
          <Stat icon="layers-outline" value={String(node.groups.length)} label={t('schedule.statSlots', { count: node.groups.length })} />
          <Stat icon="time-outline"
            value={soonest ? new Date(soonest.scheduledStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
            label={soonest ? t('schedule.statNext', { time: fmtTime(soonest.scheduledStart) }) : t('schedule.nothingAhead')} />
        </View>
        {node.blocked && (
          <View style={{ flexDirection: 'row', gap: 8, borderRadius: radius.md, padding: 12, backgroundColor: colors.bgMuted }}>
            <Glyph name="lock-closed-outline" size={14} color={colors.textMuted} />
            <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: colors.textSecondary }}>{t('schedule.blockedLong')}</Text>
          </View>
        )}
      </View>
    </View>
  )
}

function Stat({ icon, value, label, accent }: { icon: 'calendar-outline' | 'globe-outline' | 'layers-outline' | 'time-outline'; value: string; label: string; accent?: boolean }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md,
      backgroundColor: accent ? colors.primaryLight : colors.bgMuted }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSurface }}>
        <Glyph name={icon} size={15} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: 16, color: colors.textPrimary }}>{value}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted }}>{label}</Text>
      </View>
    </View>
  )
}

/* ── Level 3: the dated sessions ────────────────────────────────── */

/** Still ahead on the screen's own clock: not cancelled, not yet over. */
const isAheadAt = (lc: LiveClass, now: number) =>
  lc.status !== 'cancelled' && now < new Date(lc.scheduledStart).getTime() + (lc.durationMins || 60) * 60_000

interface Picks { key?: string; language: string | null; tutorId: string | null; mode: SessionMode | null; day: string }
const NO_PICKS = { language: null, tutorId: null, mode: null, day: 'all' } as const

interface Dated { lc: LiveClass; group: ClassGroup; booking?: MyBooking; status: SlotStatus; heldTwin?: LiveClass }

/**
 * The website's module sheet: a section head, a sticky day strip with a
 * Filter button (Language, Instructor, Mode in a bottom sheet), then every
 * session still ahead, banded by the student's own calendar day. The weekly
 * series survives as the one-seat-per-series rule (hasOther), not as a card.
 */
export function SessionsBoard({ groups, bookingMap, blocked = false, header, refreshing, onRefresh, resetKey }: {
  groups: ClassGroup[]
  bookingMap: Map<string, MyBooking>
  /** The whole module is barred for this student (drawn locked). */
  blocked?: boolean
  header?: ReactNode
  refreshing: boolean
  onRefresh: () => void
  /** Filters start over when this changes (another module). */
  resetKey?: string
}) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const { state } = useAuth()
  const pendingReg = state.status === 'signedIn' && state.user.enrollmentStatus === 'pending'

  /* The picks belong to one module (resetKey): walking to another starts
     over, so a Hindi pick never empties an English-only module. */
  const [picks, setPicks] = useState<Picks>({ key: resetKey, ...NO_PICKS })
  const cur = picks.key === resetKey ? picks : { key: resetKey, ...NO_PICKS }
  const pick = (p: Partial<Picks>) => setPicks({ ...cur, ...p })
  const clear = () => pick({ language: null, tutorId: null, mode: null })
  const [sheet, setSheet] = useState(false)

  const now = useNow(useMemo(() => groups.flatMap(g => g.slots), [groups]))
  /* Derived on the minute: nothing below changes faster than that. */
  const nowMin = Math.floor(now / 60_000)

  /* The time cut runs before the facets, so a filter never offers a value
     that comes back empty. */
  const live = useMemo(() => groups.filter(g => g.slots.some(lc => isAheadAt(lc, nowMin * 60_000))), [groups, nowMin])
  const facets = useMemo(() => moduleFacets(live), [live])
  const showLang = showFacet(facets.languages)
  const showTutor = showFacet(facets.instructors)
  const showMode = showFacet(facets.modes)

  /* A pick that is no longer offered stops filtering from off-screen. */
  const language = showLang && cur.language && facets.languages.includes(cur.language) ? cur.language : null
  const tutorId = showTutor && cur.tutorId && facets.instructors.some(i => i.id === cur.tutorId) ? cur.tutorId : null
  const mode = showMode && cur.mode && facets.modes.includes(cur.mode) ? cur.mode : null

  const filtered = useMemo(
    () => filterGroups(live, language, tutorId, mode),
    [live, language, tutorId, mode],
  )

  const { buckets, rows } = useMemo(() => {
    const at = nowMin * 60_000
    const byId = new Map<string, Dated>()
    const ahead: LiveClass[] = []
    /* One seat per hybrid class, as the server rules (bookings.routes): the
       twin can sit in another group when its title differs, so it is found
       by its pair id across everything on the board, not inside the group. */
    const heldByPair = new Map<string, LiveClass>()
    for (const g of groups) for (const lc of g.slots) {
      if (lc.hybridPairId && bookingMap.get(lc.id)?.status === 'booked') heldByPair.set(lc.hybridPairId, lc)
    }
    for (const g of filtered) {
      const heldId = g.bookedSlot?.id
      for (const lc of g.slots) {
        if (!isAheadAt(lc, at)) continue
        const booking = bookingMap.get(lc.id)
        const twin = lc.hybridPairId ? heldByPair.get(lc.hybridPairId) : undefined
        const heldTwin = twin && twin.id !== lc.id ? twin : undefined
        byId.set(lc.id, { lc, group: g, booking, heldTwin, status: getSlotStatus(lc, booking, (!!heldId && heldId !== lc.id) || !!heldTwin) })
        ahead.push(lc)
      }
    }
    return { buckets: groupByDay(ahead, at), rows: byId }
  }, [filtered, groups, bookingMap, nowMin])

  const shown = rows.size
  const total = useMemo(
    () => groups.reduce((n, g) => n + g.slots.filter(lc => isAheadAt(lc, nowMin * 60_000)).length, 0),
    [groups, nowMin],
  )
  /* A picked day that no longer has sessions falls back to all. */
  const day = cur.day !== 'all' && buckets.some(b => b.key === cur.day) ? cur.day : 'all'
  const shownBuckets = day === 'all' ? buckets : buckets.filter(b => b.key === day)
  const activeFilters = [language, tutorId, mode].filter(Boolean).length
  const hasFilters = showLang || showTutor || showMode
  const filtering = activeFilters > 0

  return (
    <>
      <ScrollView stickyHeaderIndices={buckets.length > 0 ? [1] : undefined}
        contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
        <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 16 }}>
          {header}
          <SectionHead label={t('schedule.upcoming')} note={shown !== total ? t('schedule.shownOf', { shown, total }) : t('schedule.sessionCount', { count: total })} />
        </View>

        {buckets.length > 0 ? (
          <View style={{ backgroundColor: colors.bgPage, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}
                contentContainerStyle={{ gap: 8, paddingLeft: 16, paddingRight: 4 }}>
                {[{ key: 'all', label: t('schedule.all'), n: shown }, ...buckets.map(b => ({ key: b.key, label: b.label, n: b.items.length }))].map(c => (
                  <DayChip key={c.key} label={c.label} count={c.n} active={day === c.key} onPress={() => { haptic.select(); pick({ day: c.key }) }} />
                ))}
              </ScrollView>
              {hasFilters && (
                <Pressable onPress={() => setSheet(true)} accessibilityRole="button"
                  accessibilityLabel={`${t('schedule.filter')}${activeFilters ? `, ${activeFilters}` : ''}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 18, borderWidth: 1,
                    borderColor: filtering ? colors.primary : colors.border, backgroundColor: filtering ? colors.primaryLight : colors.bgSurface }}>
                  <Glyph name="options-outline" size={16} color={colors.primary} />
                  <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.primary }}>{t('schedule.filter')}</Text>
                  {filtering && (
                    <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryFill }}>
                      <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: '#FFFFFF' }}>{activeFilters}</Text>
                    </View>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        ) : <View />}

        <View style={{ paddingHorizontal: 16, gap: 22, paddingTop: 4 }}>
          {buckets.length === 0 ? (
            <Empty icon={filtering ? 'funnel-outline' : 'calendar-outline'}
              title={filtering ? t('schedule.noMatch') : t('schedule.nothingYet')}
              body={filtering ? t('schedule.noMatchBody') : t('schedule.nothingYetBody')}
              action={filtering ? { label: t('schedule.clear'), onPress: clear } : undefined} />
          ) : shownBuckets.map(bucket => (
            <View key={bucket.key} style={{ gap: 10 }}>
              <DayHead bucket={bucket} />
              {bucket.items.map(lc => {
                const s = rows.get(lc.id)
                return s ? <SessionCard key={lc.id} s={s} blocked={blocked} pendingReg={pendingReg} now={now} /> : null
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <FilterSheet visible={sheet} onClose={() => setSheet(false)} shown={shown}
        onClear={clear}>
        {showLang && (
          <FilterRow icon="globe-outline" label={t('schedule.language')} value={language} onChange={v => pick({ language: v })}
            options={facets.languages.map(l => ({ id: l, label: l }))} />
        )}
        {showTutor && (
          <FilterRow icon="person-outline" label={t('schedule.instructor')} value={tutorId} onChange={v => pick({ tutorId: v })}
            options={facets.instructors.map(i => ({ id: i.id, label: i.name, avatar: i.avatarUrl ?? null }))} />
        )}
        {showMode && (
          <FilterRow icon="location-outline" label={t('schedule.mode')} value={mode} onChange={v => pick({ mode: v as SessionMode | null })}
            options={facets.modes.map(m => ({ id: m, label: m === 'online' ? t('schedule.online') : t('schedule.inPerson') }))} />
        )}
      </FilterSheet>
    </>
  )
}

function SectionHead({ label, note }: { label: string; note?: string }) {
  const { colors, fonts } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Glyph name="calendar" size={14} color={colors.primary} />
      <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{label}</Text>
      {!!note && <Text style={{ fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1, color: colors.textMuted }}>{note.toUpperCase()}</Text>}
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  )
}

function DayChip({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  const { colors, fonts } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={`${label}, ${count}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1,
        borderColor: active ? colors.primaryFill : colors.border, backgroundColor: active ? colors.primaryFill : colors.bgSurface }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: active ? '#FFFFFF' : colors.textSecondary }}>{label}</Text>
      <View style={{ minWidth: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', backgroundColor: active ? 'rgba(255,255,255,0.22)' : colors.bgMuted }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 11, lineHeight: 17, color: active ? '#FFFFFF' : colors.textSecondary }}>{count}</Text>
      </View>
    </Pressable>
  )
}

/** "Today · Fri 23 Oct ───── 2 classes". */
function DayHead({ bucket }: { bucket: DayBucket }) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const needsDate = bucket.label === 'Today' || bucket.label === 'Tomorrow'
  const [y, m, d] = bucket.key.split('-').map(Number)
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(Date.UTC(y!, m! - 1, d!, 12)))
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {bucket.today && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }} />}
      <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 17, color: bucket.today ? colors.primary : colors.textPrimary }}>
        {bucket.label === 'Today' ? t('schedule.today') : bucket.label === 'Tomorrow' ? t('schedule.tomorrow') : bucket.label}
      </Text>
      {needsDate && <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.textMuted }}>{date}</Text>}
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text style={{ fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1, color: colors.textMuted }}>
        {t('schedule.classes', { count: bucket.items.length }).toUpperCase()}
      </Text>
    </View>
  )
}

/** One dated session, and the one thing to do with it. */
function SessionCard({ s, blocked, pendingReg, now }: { s: Dated; blocked: boolean; pendingReg: boolean; now: number }) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const { lc, group, booking, status } = s
  /* Barred: the module is locked for this student, or this one session is
     outside their entitlement — the API would refuse the seat. */
  const barred = blocked || (lc.isEnrolled === true && lc.isEntitled === false)
  const effective: SlotStatus = barred && (status === 'bookable' || status === 'full') ? 'locked' : status
  const shown = displayStatus(effective, lc, now)
  const live = shown === 'live'
  const offline = lc.isOnline === false
  const where = offline ? [lc.location, lc.room].filter(Boolean).join(' · ') || t('schedule.inPerson') : t('schedule.online')
  const [clock, ampm] = fmtTime(lc.scheduledStart).split(' ')

  const cap = lc.sessionCapacity
  const left = Math.max(0, seatsLeft(lc))
  const yours = lc.seatsLeftForYou != null
  const showSeats = !barred && cap > 0 && (effective === 'bookable' || effective === 'full' || effective === 'booked')
  const taken = cap ? Math.min(100, Math.max(0, Math.round(((cap - left) / cap) * 100))) : 0
  const scarce = left > 0 && left <= 3

  const heldTwin = s.heldTwin

  return (
    <Pressable onPress={() => router.push(`/class/${lc.id}`)} accessibilityRole="button"
      accessibilityLabel={`${fmtTime(lc.scheduledStart)}, ${lc.title}${group.instructor ? `, ${group.instructor.name}` : ''}, ${t(`status.${shown}`)}`}
      style={({ pressed }) => ({
        backgroundColor: colors.bgSurface, borderRadius: radius.lg, padding: 14, gap: 10,
        borderWidth: live ? 1.5 : 1, borderColor: live ? colors.danger : colors.border,
        opacity: barred ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }],
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.display, color: colors.textPrimary }}>
            <Text style={{ fontSize: 26 }}>{clock}</Text>
            {!!ampm && <Text style={{ fontSize: 14 }}>{` ${ampm}`}</Text>}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Glyph name={offline ? 'location-outline' : 'videocam-outline'} size={12} color={colors.textMuted} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }}>
              {`${t('classes.minutesShort', { mins: lc.durationMins || 60 })} · ${where}`}
            </Text>
          </View>
        </View>
        <StatusPill status={shown} />
      </View>

      <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.textPrimary }}>{lc.title}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {group.instructor ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <Avatar name={group.instructor.name} uri={group.instructor.avatarUrl} size={22} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary }}>{group.instructor.name}</Text>
          </View>
        ) : (
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted }}>{t('schedule.tba')}</Text>
        )}
        {!!lc.language && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: `${colors.success}22` }}>
            <Glyph name="globe-outline" size={11} color={colors.successInk} />
            <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.successInk }}>{lc.language}</Text>
          </View>
        )}
      </View>

      {showSeats && (
        <View style={{ gap: 5 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: scarce ? colors.warning : colors.textSecondary }}>
              {left === 0 ? t('schedule.noSeats') : yours ? t('schedule.seatsYours', { count: left }) : t('schedule.seatsLeft', { count: left, total: cap })}
            </Text>
            {!yours && <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted }}>{t('schedule.bookedCount', { count: cap - left })}</Text>}
          </View>
          {/* Shared classes count YOUR academy's allocation, so no meter. */}
          {!yours && (
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.bgMuted, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              <View style={{ width: `${taken}%`, height: '100%', backgroundColor: left === 0 ? colors.textMuted : scarce ? colors.warning : colors.success }} />
            </View>
          )}
        </View>
      )}

      {barred && effective === 'locked'
        ? <Note icon="lock-closed-outline" text={t('schedule.moduleLocked')} />
        : pendingReg && effective === 'bookable'
          ? <Note icon="document-text-outline" text={t('schedule.finishRegistration')} onPress={() => router.push('/profile/complete')} />
          : <ClassAction lc={lc} booking={booking} status={effective} heldTwin={heldTwin} now={now} />}
    </Pressable>
  )
}

function Note({ icon, text, onPress }: { icon: 'lock-closed-outline' | 'document-text-outline'; text: string; onPress?: () => void }) {
  const { colors, fonts, radius } = useTheme()
  return (
    <Pressable disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'link' : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, padding: 11, backgroundColor: colors.bgMuted }}>
      <Glyph name={icon} size={15} color={onPress ? colors.primary : colors.textMuted} />
      <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13, color: onPress ? colors.primary : colors.textSecondary }}>{text}</Text>
      {onPress && <Glyph name="chevron-forward" size={14} color={colors.primary} />}
    </Pressable>
  )
}

/* ── The filter, in a bottom sheet ──────────────────────────────── */

function FilterSheet({ visible, onClose, onClear, shown, children }: {
  visible: boolean; onClose: () => void; onClear: () => void; shown: number; children: ReactNode
}) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(2,6,16,0.5)' }} />
        <View style={{ backgroundColor: colors.bgSurface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
          paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 + insets.bottom, gap: 18 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 20, color: colors.textPrimary }}>{t('schedule.filterTitle')}</Text>
          {children}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Pressable onPress={onClear} accessibilityRole="button"
              style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: radius.lg, backgroundColor: colors.bgMuted }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary }}>{t('schedule.clear')}</Text>
            </Pressable>
            <Pressable onPress={onClose} accessibilityRole="button"
              style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: radius.lg, backgroundColor: colors.primaryFill }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' }}>{t('schedule.show', { count: shown })}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function FilterRow({ icon, label, options, value, onChange }: {
  icon: 'globe-outline' | 'person-outline' | 'location-outline'; label: string
  options: { id: string; label: string; avatar?: string | null }[]
  value: string | null; onChange: (v: string | null) => void
}) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const chip = (id: string | null, text: string, avatar?: string | null) => {
    const on = value === id
    return (
      <Pressable key={id ?? 'any'} onPress={() => { haptic.select(); onChange(id) }} accessibilityRole="button" accessibilityState={{ selected: on }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: avatar !== undefined ? 4 : 14, paddingRight: 14, height: 36, borderRadius: 18,
          borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryLight : colors.bgSurface }}>
        {avatar !== undefined && <Avatar name={text} uri={avatar} size={26} />}
        <Text style={{ fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 13, color: on ? colors.primary : colors.textSecondary }}>{text}</Text>
      </Pressable>
    )
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Glyph name={icon} size={14} color={colors.primary} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, color: colors.textMuted }}>{label.toUpperCase()}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {chip(null, t('schedule.all'))}
        {options.map(o => chip(o.id, o.label, o.avatar))}
      </View>
    </View>
  )
}
