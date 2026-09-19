'use client'

/* ─────────────────────────────────────────────────────────────────────────
   Course → Module → Class.

   The flat list beside this one answers "what is on this week". This answers
   "what does this course teach, and when can I join it" — a catalogue you
   drill into, not a diary you page through. plan.md §9.

   THREE THINGS THIS DELIBERATELY DOES NOT DO:

   · It does not fetch. Every level is derived from the SAME array the flat
     list renders, so the two can never disagree about a class. A second
     endpoint would have been a second source of truth.
   · It does not re-derive the door. Course, module, seats and entitlement all
     come from the `eff*` readers in lib/classSchedule, which resolve the door
     the caller actually came through. A guest sees their own academy's course
     and their own module, never the host's.
   · It does not book. Clicking a slot hands the group back to the page, which
     opens the existing SlotModal — where the ten slot states, the seven error
     codes and the join clock already live.
   ───────────────────────────────────────────────────────────────────────── */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen, ChevronRight, Globe, Layers, Lock, Users, Clock,
  GraduationCap, Share2, Calendar, ArrowLeft, Radio,
} from 'lucide-react'
import type { LiveClass } from '@/lib/api/liveClasses'
import type { MyBooking } from '@/lib/api/bookings'
import { titleCase } from '@/lib/titleCase'
import { AvatarImg } from '@/components/ui/AvatarImg'
import {
  getSlotStatus, SC, seatsLeft, slotPattern, nextSlot,
  buildCatalog, GENERAL_MODULE_ID as GENERAL,
  type ClassGroup, type SlotStatus, type CourseNode, type ModuleNode,
} from '@/lib/classSchedule'

/** "1 module" / "2 modules" — screen readers read the aria-label out loud. */
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/* ── Shared chrome ──────────────────────────────────────────────────────── */

const enter = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }
const spring = { type: 'spring' as const, stiffness: 280, damping: 26 }
const cardHover = {
  whileHover: { y: -3, boxShadow: '0 16px 40px rgba(0,0,0,0.09)' },
  whileTap:   { scale: 0.99 },
  transition: { type: 'spring' as const, stiffness: 350, damping: 28 },
}
const CARD: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
}

/* The violet the admin dashboard marks cross-academy work with, so a shared
   class reads the same on both sides of the product. */
const SHARED_RGB = '167,139,250'

function Pill({ icon, children, rgb = '0,87,184', solid }: {
  icon?: React.ReactNode; children: React.ReactNode; rgb?: string; solid?: string
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `rgba(${rgb},0.08)`, color: solid ?? `rgb(${rgb})`, border: `1px solid rgba(${rgb},0.20)` }}>
      {icon}{children}
    </span>
  )
}

function Crumbs({ trail }: { trail: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-[11px]">
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={11} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />}
          {c.onClick ? (
            <button type="button" onClick={c.onClick}
              className="rounded font-semibold transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-primary-on-surface, var(--color-primary))' }}>
              {c.label}
            </button>
          ) : (
            <span className="font-semibold" style={{ color: 'var(--color-text-muted)' }}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold transition-colors"
      style={{ color: 'var(--color-text-secondary)' }}>
      <ArrowLeft size={13} strokeWidth={2} />{label}
    </button>
  )
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <motion.div {...enter} transition={spring}
      className="flex flex-col items-center gap-4 rounded-3xl bg-[var(--color-bg-surface)] py-20 text-center"
      style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl"
        style={{ background: 'rgba(0,87,184,0.07)', border: '1px solid rgba(0,87,184,0.14)' }}>
        {icon}
      </div>
      <div>
        <p className="syne text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>{title}</p>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{body}</p>
      </div>
    </motion.div>
  )
}

/* ── Level 1 — the courses ──────────────────────────────────────────────── */

function CourseCard({ node, index, onOpen }: {
  node: CourseNode; index: number; onOpen: () => void
}) {
  const moduleCount = node.modules.length
  return (
    <motion.button type="button" onClick={onOpen}
      {...cardHover}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      style={{ ...CARD, transitionDelay: `${index * 40}ms` }}
      aria-label={`${node.title} — ${plural(moduleCount,'module')}, ${plural(node.sessionCount,'session')}`}
      className="dm group flex h-full w-full flex-col overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] text-left">

      <div className="relative aspect-video flex-shrink-0 overflow-hidden"
        style={{ background: 'var(--color-bg-subtle)' }}>
        {node.thumbnailUrl ? (
          <img src={node.thumbnailUrl} alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <GraduationCap size={28} strokeWidth={1.75} style={{ color: 'var(--color-text-muted)' }} />
          </div>
        )}
        {node.shared && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{
              background: `rgba(${SHARED_RGB},0.92)`, color: '#fff',
              backdropFilter: 'blur(6px)',
            }}>
            <Share2 size={8} strokeWidth={2.5} />Shared with your academy
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        {node.program && (
          <Pill icon={<Layers size={9} strokeWidth={2.5} />}>{titleCase(node.program)}</Pill>
        )}
        <h3 className="line-clamp-2 text-sm font-bold leading-snug"
          style={{ color: 'var(--color-text-primary)' }}>{titleCase(node.title)}</h3>

        <div className="mt-auto flex items-center justify-between gap-2 pt-3"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="flex items-center gap-2.5 text-[11px] font-medium"
            style={{ color: 'var(--color-text-muted)' }}>
            <span className="flex items-center gap-1"><Layers size={10} strokeWidth={2} />{moduleCount} {moduleCount === 1 ? 'module' : 'modules'}</span>
            <span className="flex items-center gap-1"><Calendar size={10} strokeWidth={2} />{node.sessionCount}</span>
          </span>
          <span className="flex items-center gap-1 text-[11px] font-bold"
            style={{ color: 'var(--color-primary-on-surface, var(--color-primary))' }}>
            View<ChevronRight size={12} strokeWidth={2.5} />
          </span>
        </div>
      </div>
    </motion.button>
  )
}

/* ── Level 2 — the modules ────────────────────────────────────────

   THE BANNER IS DERIVED, NOT UPLOADED.

   A module has no artwork and never will — nobody is going to photograph
   "Module 4". So the banner is computed FROM the module: one 32-bit FNV-1a
   hash over its id and title, with each visual choice reading a different
   window of that single number. Nothing calls Math.random and nothing reads
   the clock, so the server and the browser paint the same card (no hydration
   mismatch) and Module 03 looks the same today as it did last term.

   It still reads as one family because the band is deliberately narrow: every
   hue is one of six stops around Delta's own 212, lightness always runs 30%
   → 18%, and all four motifs are built from ONE primitive — the delta — over
   a light source and a hairline that every card carries.

   Neighbours cannot collide: the starting point in the hue ring is seeded
   from the COURSE, then `position` advances it by a stride of 5 in a ring of
   6 (coprime, so it visits all six before repeating) and the motif by 1 in 4.
   Two cards side by side therefore differ in both colour and geometry by
   construction rather than by luck.

   The banner's colours are fixed hsl(), not tokens, on purpose: a 30%–18%
   surface is dark under both themes, so the light type on it is the one place
   in this component where not using a token is correct. Everything below the
   banner is tokens.
   ──────────────────────────────────────────────────────────────────── */

/** FNV-1a, 32 bits. Pure and integer-only, so SSR and the client agree. */
function moduleHash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** "01", "10" — always two glyphs at one width, so the numerals form a true
    column down the grid and scanning a course becomes counting rather than
    reading. */
const pad2 = (n: number) => String(n).padStart(2, '0')

/** The three points of a delta, the only shape these banners are drawn with.
    Fixed to 2dp so the emitted markup is byte-identical on both sides. */
function deltaPts(cx: number, cy: number, r: number, rot: number): string {
  return [0, 120, 240].map(a => {
    const t = ((a + rot) * Math.PI) / 180
    return `${(cx + r * Math.sin(t)).toFixed(2)},${(cy - r * Math.cos(t)).toFixed(2)}`
  }).join(' ')
}

/* Six stops with Delta's 212 IN the set, not either side of it. Saturation
   rises toward the brand as the hue approaches it, so the blue card looks
   like the product and the others look like its neighbours. */
const HUES: [number, number][] = [
  [196, 62], [204, 74], [212, 88], [220, 74], [228, 62], [188, 56],
]

interface Skin {
  variant: number; tilt: number; ax: number; tile: number
  wash: string; tint: string; uid: string
}

function moduleSkin(id: string, title: string, position: number | null, courseTitle: string): Skin {
  const h    = moduleHash(`${id}·${title.trim().toLowerCase()}`)
  /* The ring's STARTING point is a property of the course, not the module —
     seeded from the module's own hash it collided one time in six between
     adjacent cards. */
  const ring = moduleHash(courseTitle || 'delta')
  const bit  = (shift: number, n: number) => ((h >>> shift) & 0x1f) % n

  const pos      = position ?? 0
  const [hue, sat] = HUES[(ring + pos * 5) % HUES.length]!
  const deepHue  = (hue + 18) % 360
  const angle    = 118 + bit(25, 4) * 18

  return {
    variant: (bit(5, 4) + pos) % 4,
    tilt:    -16 + bit(10, 5) * 8,
    ax:       46 + bit(15, 5) * 22,
    tile:     20 + bit(20, 4) * 6,
    /* The deep stop stops at 18%, not 12%: at 12% the banner's foot matched
       --color-bg-surface in dark mode and the card read as a hole with a
       hairline floating in it. */
    wash: `linear-gradient(${angle}deg, hsl(${hue} ${sat}% 30%) 0%, hsl(${deepHue} ${sat + 4}% 18%) 100%)`,
    tint: `hsl(${hue} 92% 76%)`,
    uid:  `dm${h.toString(36)}`,
  }
}

function ModuleGeometry({ skin }: { skin: Skin }) {
  const { variant, tilt, ax, tile, tint, uid } = skin
  return (
    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden
      className="absolute inset-0 h-full w-full">
      <defs>
        <pattern id={`${uid}p`} width={tile} height={tile} patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${tilt})`}>
          <polygon points={deltaPts(tile / 2, tile / 2, tile * 0.3, 0)} fill={tint} fillOpacity="0.17" />
        </pattern>
        <radialGradient id={`${uid}g`}>
          <stop offset="0%"   stopColor={tint} stopOpacity="0.26" />
          <stop offset="100%" stopColor={tint} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* family constant #1 — one light source, on every card */}
      <circle cx={ax} cy={34} r={58} fill={`url(#${uid}g)`} />

      {variant === 0 && [1, 0.7, 0.45, 0.24].map((sc, i) => (
        <polygon key={i} points={deltaPts(ax, 48, 54 * sc, tilt)}
          fill="none" stroke={tint} strokeOpacity={0.12 + i * 0.07} strokeWidth="1.1" />
      ))}
      {variant === 1 && [0, 1, 2, 3, 4].map(i => (
        <polygon key={i} points={deltaPts(ax - 40 + i * 24, 14 + i * 16, 15, tilt + i * 12)}
          fill={tint} fillOpacity={0.06 + i * 0.045} />
      ))}
      {variant === 2 && <rect width="160" height="90" fill={`url(#${uid}p)`} />}
      {variant === 3 && (
        <>
          <polygon points={deltaPts(ax, 42, 60, tilt)} fill={tint} fillOpacity="0.10" />
          <polygon points={deltaPts(ax - 34, 66, 28, tilt + 180)}
            fill="none" stroke={tint} strokeOpacity="0.30" strokeWidth="1.2" />
        </>
      )}

      {/* family constant #2 — the hairline the whole set shares */}
      <line x1="0" y1="89.4" x2="160" y2="89.4" stroke={tint} strokeOpacity="0.32" strokeWidth="1.2" />
    </svg>
  )
}

function ModuleCard({ node, position, index, courseTitle, onOpen }: {
  node: ModuleNode; position: number | null; index: number
  courseTitle: string; onOpen: () => void
}) {
  const skin = useMemo(
    () => moduleSkin(node.id, node.title, position, courseTitle),
    [node.id, node.title, position, courseTitle],
  )

  const locked = node.blocked
  const empty  = node.sessionCount === 0
  /* Locked and empty are different sentences, and a locked module with no
     sessions must not offer to show them. */
  const cta = empty ? 'Nothing scheduled' : locked ? 'View sessions' : 'Choose a slot'

  return (
    /* ONE focusable element, as CourseCard is. The CTA below is a span that
       looks like a button — nesting a real button inside this one would make
       the card unreachable by keyboard and invalid HTML. */
    <motion.button type="button" onClick={onOpen}
      {...cardHover}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: index * 0.035 }}
      style={CARD}
      aria-label={`${node.title} — ${plural(node.sessionCount, 'session')}${locked ? ', locked' : ''}`}
      className="dm group flex h-full w-full flex-col overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] text-left">

      {/* ── the banner ── */}
      <div className="relative aspect-video flex-shrink-0 overflow-hidden"
        style={{ background: skin.wash, opacity: locked ? 0.55 : 1, filter: locked ? 'grayscale(0.9)' : undefined }}>
        <ModuleGeometry skin={skin} />

        <div className="absolute inset-0 flex flex-col justify-end p-3.5">
          <span className="dm text-[9px] font-bold uppercase tracking-[0.18em]"
            style={{ color: 'rgba(255,255,255,0.72)' }}>
            {position !== null ? 'Module' : 'Sessions'}
          </span>
          {position !== null && (
            /* Not pure #FFF: the dark palette stops at #E8EAF0 to avoid
               haloing, and a 30px numeral is exactly that case. */
            <span className="syne text-[30px] font-extrabold leading-none tracking-tight"
              style={{ color: 'rgba(255,255,255,0.95)' }}>
              {pad2(position)}
            </span>
          )}
        </div>

        {locked && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{ background: 'rgba(15,23,42,0.55)', color: '#fff', backdropFilter: 'blur(6px)' }}>
            <Lock size={8} strokeWidth={2.5} />Locked
          </span>
        )}
      </div>

      {/* ── the body ── */}
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <h3 className="line-clamp-2 text-sm font-bold leading-snug"
          style={{ color: 'var(--color-text-primary)' }}>{titleCase(node.title)}</h3>

        {node.description && (
          <p className="line-clamp-3 text-xs leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}>{node.description}</p>
        )}

        {/* The hairline every sibling card separates its footer with. */}
        <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] font-medium"
          style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
          <span className="flex items-center gap-1">
            <Globe size={10} strokeWidth={2} />{plural(node.languages.length, 'Language')}
          </span>
          <span className="flex items-center gap-1">
            <Calendar size={10} strokeWidth={2} />{plural(node.sessionCount, 'Session')}
          </span>
        </div>

        {/* Delta blue and white, the primary CTA every other screen uses —
            stable in both themes, unlike an ink button whose inverse text
            flips with the palette. */}
        <span aria-hidden
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold transition-opacity group-hover:opacity-90"
          style={locked || empty
            ? { background: 'var(--color-bg-inset)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }
            : { background: 'var(--color-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(0,87,184,0.25)' }}>
          {locked ? <Lock size={12} strokeWidth={2.5} /> : <BookOpen size={12} strokeWidth={2.5} />}
          {cta}
        </span>
      </div>
    </motion.button>
  )
}

/* ── Level 3 — the slots inside a module ────────────────────────────────── */

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function SlotGroupRow({ group, bookingMap, index, onOpen }: {
  group: ClassGroup; bookingMap: Map<string, MyBooking>; index: number; onOpen: () => void
}) {
  const next    = nextSlot(group.slots) ?? group.slots[0]!
  const pattern = slotPattern(group.slots)
  const booking = bookingMap.get(next.id)
  const hasOther = !!group.bookedSlot && group.bookedSlot.id !== next.id
  const status: SlotStatus = getSlotStatus(next, booking, hasOther)
  const c = SC[status]
  const left = seatsLeft(next)

  return (
    <motion.button type="button" onClick={onOpen}
      {...cardHover}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: index * 0.03 }}
      style={CARD}
      aria-label={`${group.title} — ${pattern ? `${pattern.weekday}s at ${pattern.time}` : `next ${fmtDate(next.scheduledStart)}`}, ${c.label}`}
      className="dm flex w-full items-center gap-3 rounded-2xl bg-[var(--color-bg-surface)] px-3.5 py-3 text-left">

      <div className="flex h-10 w-10 flex-shrink-0 flex-col items-center justify-center rounded-xl"
        style={{ background: `${c.bg}`, color: c.color, border: `1px solid ${c.border}` }}>
        {status === 'live'
          ? <Radio size={15} strokeWidth={2.25} />
          : <><span className="text-[9px] font-bold uppercase leading-none">{fmtDate(next.scheduledStart).split(' ')[0]}</span>
              <span className="text-[13px] font-black leading-tight">{new Date(next.scheduledStart).getDate()}</span></>}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {pattern ? `${pattern.weekday}s · ${pattern.time}` : `${fmtDate(next.scheduledStart)} · ${fmtTime(next.scheduledStart)}`}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px]"
          style={{ color: 'var(--color-text-muted)' }}>
          {group.instructor && (
            <>
              <AvatarImg src={group.instructor.avatarUrl} name={group.instructor.name}
                className="h-3.5 w-3.5 rounded-full object-cover"
                fallbackClassName="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-bold"
                fallbackStyle={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }} />
              <span className="truncate">{group.instructor.name}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {pattern
            ? <span className="whitespace-nowrap">next {fmtDate(next.scheduledStart)}</span>
            : <span className="whitespace-nowrap">{group.slots.length} {group.slots.length === 1 ? 'session' : 'sessions'}</span>}
        </p>
      </div>

      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
          style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
          {status === 'bookable' && next.sessionCapacity > 0 ? `${Math.max(0, left)} left` : c.label}
        </span>
        {group.slots.length > 1 && (
          <span className="flex items-center gap-0.5 text-[9px] font-semibold"
            style={{ color: 'var(--color-text-muted)' }}>
            <Clock size={8} strokeWidth={2.5} />{group.slots.length} dates
          </span>
        )}
      </div>
    </motion.button>
  )
}

/* ── The view ───────────────────────────────────────────────────────────── */

export function Hierarchy({
  classes, bookingMap, search, courseId, moduleId, onNavigate, onOpenGroup,
}: {
  classes:     LiveClass[]
  bookingMap:  Map<string, MyBooking>
  search:      string
  courseId:    string | null
  moduleId:    string | null
  onNavigate:  (courseId: string | null, moduleId: string | null) => void
  onOpenGroup: (group: ClassGroup) => void
}) {
  const catalog = useMemo(() => buildCatalog(classes, bookingMap), [classes, bookingMap])

  const q = search.trim().toLowerCase()

  /* Level 1 searches course and module names together, so typing a module
     name finds the course that holds it rather than nothing. */
  const visibleCourses = useMemo(() => {
    if (!q) return catalog
    return catalog.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.program ?? '').toLowerCase().includes(q) ||
      c.modules.some(m => m.title.toLowerCase().includes(q)))
  }, [catalog, q])

  const course = courseId !== null ? catalog.find(c => c.id === courseId) : undefined
  const mod    = course && moduleId !== null ? course.modules.find(m => m.id === moduleId) : undefined

  /* ── Level 3 ── */
  if (course && mod) {
    /* The search box stays on screen at every level, so it has to mean
       something at every level. Here it matches the class title, the
       instructor and the language — the three things that distinguish one
       slot of a module from another. */
    const groups = q
      ? mod.groups.filter(g =>
          g.title.toLowerCase().includes(q) ||
          (g.instructor?.name ?? '').toLowerCase().includes(q) ||
          ((g.slots[0] as { language?: string }).language ?? '').toLowerCase().includes(q))
      : mod.groups

    const byLanguage = new Map<string, ClassGroup[]>()
    for (const g of groups) {
      const lang = (g.slots[0] as { language?: string }).language || 'Unspecified'
      if (!byLanguage.has(lang)) byLanguage.set(lang, [])
      byLanguage.get(lang)!.push(g)
    }
    const languages = [...byLanguage.keys()].sort()
    const position  = mod.id === GENERAL ? null : course.modules.filter(m => m.id !== GENERAL).indexOf(mod) + 1

    return (
      <motion.div {...enter} transition={spring} key={`m:${course.id}:${mod.id}`}>
      {/* ONE child, deliberately. framer re-creates this element with its
          children as a plain array, and React demands keys from an array of
          children — a static JSX child list normally escapes that via the
          `jsxs` fast path, but the mark does not survive the round trip. A
          Fragment collapses them to one child and adds no DOM node. */}
      <>
        <BackLink label={titleCase(course.title)} onClick={() => onNavigate(course.id, null)} />
        <Crumbs trail={[
          { label: 'Courses', onClick: () => onNavigate(null, null) },
          { label: titleCase(course.title), onClick: () => onNavigate(course.id, null) },
          { label: titleCase(mod.title) },
        ]} />

        <div className="mb-5 rounded-2xl bg-[var(--color-bg-surface)] p-4" style={CARD}>
          <p className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)' }}>
            {position !== null ? `Module ${position}` : 'Sessions'}
          </p>
          <h2 className="syne mt-0.5 text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {titleCase(mod.title)}
          </h2>
          {mod.description && (
            <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {mod.description}
            </p>
          )}
          {mod.blocked && (
            <div className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2"
              style={{ background: 'rgba(107,114,128,0.07)', border: '1px solid rgba(107,114,128,0.16)' }}>
              <Lock size={12} strokeWidth={2} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                Your access to this module is turned off, so its sessions cannot be
                booked. They are listed here so you can see what it covers — contact
                your admin to have it opened.
              </p>
            </div>
          )}
        </div>

        <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-text-muted)' }}>Available sessions</h3>

        {groups.length === 0 ? (
          <Empty icon={<Calendar size={26} style={{ color: 'var(--color-primary)' }} />}
            title={q ? 'No sessions match' : 'Nothing scheduled yet'}
            body={q ? 'Try a different search term, or clear the search to see them all.'
                    : 'This module has no upcoming sessions. Check back soon.'} />
        ) : (
          <div className="space-y-5">
            {languages.map(lang => (
              <section key={lang}>
                <div className="mb-2 flex items-center gap-2">
                  <Globe size={11} strokeWidth={2.25} style={{ color: 'var(--color-success)' }} />
                  <h4 className="text-[12px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{lang}</h4>
                  <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    {byLanguage.get(lang)!.length} {byLanguage.get(lang)!.length === 1 ? 'slot' : 'slots'}
                  </span>
                </div>
                <div className="space-y-2">
                  {byLanguage.get(lang)!.map((g, i) => (
                    <SlotGroupRow key={g.id} group={g} bookingMap={bookingMap} index={i}
                      onOpen={() => onOpenGroup(g)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </>
      </motion.div>
    )
  }

  /* ── Level 2 ── */
  if (course) {
    /* Matching a module by its own name OR by a class inside it, so typing an
       instructor's name narrows to the modules they actually teach. `ordered`
       stays over the UNFILTERED list so "Module 3" keeps saying 3 while a
       search is running — a module's number is its place in the course, not
       its place in your search results. */
    const ordered = course.modules.filter(m => m.id !== GENERAL)
    const modules = q
      ? course.modules.filter(m =>
          m.title.toLowerCase().includes(q) ||
          (m.description ?? '').toLowerCase().includes(q) ||
          m.groups.some(g =>
            g.title.toLowerCase().includes(q) ||
            (g.instructor?.name ?? '').toLowerCase().includes(q)))
      : course.modules

    return (
      <motion.div {...enter} transition={spring} key={`c:${course.id}`}>
      {/* ONE child, deliberately. framer re-creates this element with its
          children as a plain array, and React demands keys from an array of
          children — a static JSX child list normally escapes that via the
          `jsxs` fast path, but the mark does not survive the round trip. A
          Fragment collapses them to one child and adds no DOM node. */}
      <>
        <BackLink label="All courses" onClick={() => onNavigate(null, null)} />
        <Crumbs trail={[
          { label: 'Courses', onClick: () => onNavigate(null, null) },
          { label: titleCase(course.title) },
        ]} />

        <div className="mb-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="syne text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {titleCase(course.title)}
            </h2>
            {course.shared && (
              <Pill icon={<Share2 size={9} strokeWidth={2.5} />} rgb={SHARED_RGB}>Shared with your academy</Pill>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {plural(course.modules.length, 'module')} · {plural(course.sessionCount, 'upcoming session')}
            {q && modules.length !== course.modules.length && ` · ${modules.length} matching`}
          </p>
        </div>

        {modules.length === 0 ? (
          <Empty icon={<Layers size={26} style={{ color: 'var(--color-primary)' }} />}
            title={q ? 'No modules match' : 'No modules yet'}
            body={q ? 'Try a different search term, or clear the search to see them all.'
                    : 'This course has no upcoming sessions.'} />
        ) : (
          /* A real course runs to ten modules, so this is a grid rather
             than a column — ten stacked banners would be three screens of
             scrolling to see a list the reference fits in two rows. */
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {modules.map((m, i) => (
              <ModuleCard key={m.id || 'general'} node={m} index={i}
                position={m.id === GENERAL ? null : ordered.indexOf(m) + 1}
                courseTitle={course.title}
                onOpen={() => onNavigate(course.id, m.id)} />
            ))}
          </div>
        )}
      </>
      </motion.div>
    )
  }

  /* ── Level 1 ── */
  return (
    <motion.div {...enter} transition={spring} key="courses">
      {visibleCourses.length === 0 ? (
        <Empty icon={<BookOpen size={26} style={{ color: 'var(--color-primary)' }} />}
          title={q ? 'No courses match' : 'No upcoming sessions'}
          body={q ? 'Try a different search term.' : 'When classes are scheduled for your courses they will appear here.'} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {visibleCourses.map((c, i) => (
            <CourseCard key={c.id || 'unassigned'} node={c} index={i}
              onOpen={() => onNavigate(c.id, null)} />
          ))}
        </div>
      )}
    </motion.div>
  )
}

/* Exported so the page can resolve a group the hierarchy opened without
   going through `dateSections`, which the hierarchy does not build. */
export function allGroupsIn(catalog: CourseNode[]): ClassGroup[] {
  return catalog.flatMap(c => c.modules.flatMap(m => m.groups))
}

