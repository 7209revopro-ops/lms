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
   · It does not book ABOVE LEVEL 3. Levels 1 and 2 are navigation and hand
     every decision downward. Level 3 does book: the session cards carry the
     ten slot states and the join clock, because a student choosing a date
     should not have to open a modal to take the seat attached to it. The
     seven booking ERROR codes still live in the page's onBook, which is
     passed in — one place that knows what the API can refuse.
   ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import {
  BookOpen, ChevronRight, Globe, Layers, Lock, Users, Clock,
  Share2, Calendar, ArrowLeft, Radio, MapPin, Video, User,
  CheckCircle2, AlertCircle, X,
} from 'lucide-react'
import type { LiveClass } from '@/lib/api/liveClasses'
import type { MyBooking } from '@/lib/api/bookings'
import { titleCase } from '@/lib/titleCase'
import { AvatarImg } from '@/components/ui/AvatarImg'
import Spinner from '@/components/ui/Spinner'
import JoinMeetButton from '@/components/live-classes/JoinMeetButton'
import { useJoinClock } from '@/hooks/useJoinClock'
import { getJoinPhase, type JoinWindowSession } from '@/lib/joinWindow'
import { useCurrentUser } from '@/lib/api/user'
import {
  getSlotStatus, SC, seatsLeft, nextSlot,
  moduleFacets, showFacet, filterGroups,
  buildCatalog, GENERAL_MODULE_ID as GENERAL,
  groupByDay, zonedKey, bookingClosedAt, offlineDayOffset,
  type ClassGroup, type SlotStatus, type CourseNode, type ModuleNode, type DayBucket,
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

/* ── The generated banner ─────────────────────────────────────────────
   Shared by levels 1 and 2. Lifted above both when the course card started
   drawing with it: reading a module top-to-bottom should not depend on
   knowing which declarations hoist.

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


/* ── Level 1 — the courses ──────────────────────────────────────

   THE SAME CARD THE CATALOG USES, WITH THE SCHEDULE'S BUTTON.

   A student meets these courses twice — once in the Catalog and once here —
   and two different cards for one course is two things to learn. So this
   follows MaterialCard in courses/page.tsx: a 16:9 cover that zooms on hover
   under a scrim with a play affordance, a type badge, the title, the
   instructor, a meta line, a hairline, and the level. What changes is the
   action: the Catalog's small right-aligned button becomes the full-width one
   this hierarchy uses at every level, because here the card has exactly one
   thing to do.

   THE COVER STILL FALLS BACK TO A DRAWN BANNER, not to the Catalog's grey box
   with an icon floating in it. `buildCatalog` drops `thumbnailUrl` for every
   SHARED course by construction, so on this screen the empty case is not a
   rare gap — it is the permanent appearance of every cross-academy course. A
   generated banner is the same family as the module cards one level down, and
   nothing in the row reads as a broken image.
   ────────────────────────────────────────────────────────────────── */

/** `level` is free text — the admin typed it by hand for years before it
    became a select — so it arrives as 'Beginner', 'BEGINNER' and 'beginner'.
    The three we know are rendered from this map rather than through
    `titleCase`, which preserves deliberate capitals and would leave 'BEGINNER'
    shouting; anything else still shows as typed. */
const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
}

function CourseCard({ node, index, onOpen }: {
  node: CourseNode; index: number; onOpen: () => void
}) {
  const moduleCount = node.modules.length
  const empty       = node.sessionCount === 0

  const raw   = node.level?.trim() ?? ''
  const level = raw ? (LEVEL_LABEL[raw.toLowerCase()] ?? titleCase(raw)) : null

  /* Remembered BY URL rather than as a boolean, so the cover comes back by
     itself if the course is later given a working one. */
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const cover = node.thumbnailUrl && node.thumbnailUrl !== failedSrc ? node.thumbnailUrl : null

  /* Hashed off the course id, not the render index: `index` is the position
     in the FILTERED grid, so seeding from it would repaint every banner in
     the row as the student types in the search box. */
  const skin = useMemo(
    () => moduleSkin(node.id, node.title, moduleHash(node.id || node.title) % 6, node.program ?? 'delta'),
    [node.id, node.title, node.program],
  )

  const tutors = node.instructors
  const tutor  = tutors.length === 1 ? tutors[0]!.name
               : tutors.length > 1   ? `${tutors.length} instructors`
               : null

  const label = [
    titleCase(node.title), ' — ', plural(moduleCount, 'module'), ', ',
    empty ? 'nothing scheduled' : plural(node.sessionCount, 'upcoming session'),
    level ? `, ${level}` : '',
    node.shared ? ', shared with your academy' : '',
  ].join('')

  return (
    /* ONE focusable element. The CTA below is a span that looks like a button
       — a real one nested here would be invalid HTML and would cost a second
       tab stop on every card.

       The stagger lives INSIDE the animate target. As a sibling `transition`
       prop it would be framer's default for whileHover and whileTap too, and
       being written after the spread it would replace cardHover's own spring,
       so the last card in the grid would sit still for a third of a second
       after the cursor reached it. */
    <motion.button type="button" onClick={onOpen}
      {...cardHover}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { ...spring, delay: Math.min(index, 11) * 0.04 } }}
      style={CARD}
      aria-label={label}
      className="dm group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary-on-surface,var(--color-primary))]">

      {/* ── cover ── */}
      <div className="relative aspect-video w-full flex-shrink-0 overflow-hidden"
        style={{ background: skin.wash }}>
        <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105">
          {cover ? (
            <img src={cover} alt="" loading="lazy" decoding="async" draggable={false}
              onError={() => setFailedSrc(cover)}
              className="h-full w-full object-cover" />
          ) : (
            <ModuleGeometry skin={skin} />
          )}
        </div>

        {/* The Catalog's hover scrim and play affordance, so the two screens
            answer a pointer the same way. */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: 'rgba(13,15,26,0.30)' }}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: 'rgba(0,87,184,0.90)', boxShadow: '0 6px 18px rgba(0,87,184,0.40)' }}>
            <ChevronRight size={15} strokeWidth={3} color="white" />
          </span>
        </div>

        {/* Top-left: how much of this course is actually on. The Catalog puts
            the runtime here; the schedule's equivalent is what you can book. */}
        <span className="absolute left-2.5 top-2.5 rounded-lg px-2 py-0.5 text-[10px] font-bold"
          style={{ background: 'rgba(13,15,26,0.68)', color: 'white', backdropFilter: 'blur(6px)' }}>
          {empty ? 'No sessions' : plural(node.sessionCount, 'session')}
        </span>

        {node.shared && (
          /* The admin dashboard's cross-academy violet, as tint on glass —
             white on #A78BFA measures about 2:1 and was the weakest type on
             the card. */
          <span className="absolute right-2.5 top-2.5 inline-flex max-w-[60%] items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{
              background: 'rgba(8,12,22,0.55)', border: `1px solid rgba(${SHARED_RGB},0.45)`,
              color: '#CFC0FF', backdropFilter: 'blur(6px)',
            }}>
            <Share2 size={8} strokeWidth={2.5} className="flex-shrink-0" />
            <span className="truncate">Shared</span>
          </span>
        )}
      </div>

      {/* ── content, in the Catalog's order ── */}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <span className="inline-flex w-fit items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: 'rgba(0,87,184,0.08)', color: 'var(--color-primary-on-surface, var(--color-primary))' }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-primary)' }} />
          Course
        </span>

        <h3 className="line-clamp-2 break-words text-sm font-bold leading-snug"
          style={{ color: 'var(--color-text-primary)' }}>{titleCase(node.title)}</h3>

        {tutor && (
          <p className="truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>{tutor}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium"
          style={{ color: 'var(--color-text-muted)' }}>
          <span className="flex items-center gap-1">
            <Layers size={10} strokeWidth={2} />{plural(moduleCount, 'module')}
          </span>
          {node.program && (
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
              {titleCase(node.program)}
            </span>
          )}
        </div>

        {/* The hairline the Catalog separates its footer with. Level sits where
            the Catalog puts it; the button below is the schedule's, full width,
            because this card has exactly one thing to do. */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="truncate text-[10px] capitalize" style={{ color: 'var(--color-text-muted)' }}>
            {level ?? 'All levels'}
          </span>
          {!empty && (
            <span className="flex-shrink-0 text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              {plural(node.sessionCount, 'session')} ahead
            </span>
          )}
        </div>

        <span aria-hidden
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold transition-opacity group-hover:opacity-90"
          style={empty
            ? { background: 'var(--color-bg-inset)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }
            : { background: 'var(--color-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(0,87,184,0.25)' }}>
          {empty ? <Calendar size={12} strokeWidth={2.5} /> : <BookOpen size={12} strokeWidth={2.5} />}
          {empty ? 'Nothing scheduled' : 'View modules'}
          {!empty && (
            <ChevronRight size={12} strokeWidth={2.5}
              className="transition-transform duration-300 group-hover:translate-x-0.5" />
          )}
        </span>
      </div>
    </motion.button>
  )
}

/* ── Level 2 — the modules ───────────────────────────────────────── */
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
      initial={{ opacity: 0, y: 12 }}
      /* The delay lives INSIDE the animate target. As a top-level
         `transition` prop it was framer's default for whileHover and whileTap
         as well, and being written after the spread it also replaced
         cardHover's own 350/28 spring — so the tenth card in the grid sat
         still for a third of a second after the cursor arrived. */
      animate={{ opacity: 1, y: 0, transition: { ...spring, delay: Math.min(index, 11) * 0.035 } }}
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


/* Clock and calendar, in the STUDENT'S OWN zone — the same zone every other
   time on this screen is rendered in, so a label and a time never disagree. */
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })


/* ── Level 3 — the module sheet ─────────────────────────────────────────────

   THE ONLY SCREEN OF THE THREE WHERE A DECISION IS MADE.

   Level 1 is a catalogue and level 2 is a contents page. This is where the
   student picks a seat, so it carries the most weight of the three — and the
   draft it replaces carried the least: a near-empty white box holding two
   words, then one full-width strip per slot laid across 1200px of nothing.

   Four deliberate moves:

   · THE MODULE'S BANNER COMES WITH IT. The student clicked a card with that
     exact colour and geometry on it; the sheet opens on the same artwork at
     full width, which is what makes this feel like the inside of that card
     rather than a different screen. It is the same pure moduleSkin() the grid
     calls, so nothing new is generated and the two can never drift.
   · THE COUNTS STOP BEING DECORATION. Sessions, languages, weekly slots and
     the soonest session sit on the header as four tiles. That is what the
     dead space is spent on, and all four were already computed.
   · THE LIST IS DATES, AND THE DATE BOOKS ITSELF. It used to be one card per
     weekly cohort, with the actual dates — and the actual booking — hidden
     behind a "Choose a time slot" modal. Now every session the module still
     has ahead is its own card, soonest first, banded under Today, Tomorrow
     and each following day, and the card carries the control: book, join,
     cancel. The weekly series survives as the rule that stops a student
     taking four seats in it; it is no longer a screen.
   · IT NEVER OVERSTATES A SEAT. On a shared class seatsLeft() is YOUR
     academy's remainder, not the room's, so the fill meter — which needs both
     numbers to be about the same pool — is dropped and the honest count is
     kept. Same reason a blocked module downgrades a bookable session: the
     API will refuse it.
   ────────────────────────────────────────────────────────────────────────── */

/** "Mar 14" — no weekday. Used where the weekday is already the headline and
    repeating it in the line below is noise. */
const fmtMonthDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** SC.color doubles as a text colour, and exactly one entry is unsafe that
    way: `bookable` is --color-primary, which is deliberately pinned to #0057b8
    in BOTH themes (globals.css: "identity is not a theme variable") and lands
    at ~2.3:1 on the dark surface. --color-primary-on-surface is the escape
    hatch the palette keeps for precisely this — blue TEXT, lifted to #6ba6ff
    in the dark. Fills and hairlines keep the brand value; only ink moves. */
const ink = (c: string) =>
  c === 'var(--color-primary)' ? 'var(--color-primary-on-surface, var(--color-primary))' : c

/* ── The header ─────────────────────────────────────────────────────────── */

function StatTile({ icon, value, label, accent }: {
  icon: React.ReactNode; value: string; label: string; accent?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2"
      style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}>
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={accent
          ? { background: 'rgba(0,87,184,0.09)', border: '1px solid rgba(0,87,184,0.18)',
              color: 'var(--color-primary-on-surface, var(--color-primary))' }
          : { background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="syne block truncate text-[13px] font-extrabold leading-tight"
          style={{ color: 'var(--color-text-primary)' }}>{value}</span>
        <span className="block truncate text-[9px] font-bold uppercase tracking-[0.12em]"
          style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      </span>
    </div>
  )
}

function ModuleHero({ node, position, course }: {
  node: ModuleNode; position: number | null; course: CourseNode
}) {
  const skin = useMemo(
    () => moduleSkin(node.id, node.title, position, course.title),
    [node.id, node.title, position, course.title],
  )

  /* The soonest session anywhere in the module — the one fact a student wants
     before they read anything else, and one the module card had no room for. */
  const soonest = useMemo(() => {
    let best: LiveClass | undefined
    for (const g of node.groups) {
      const n = nextSlot(g.slots)
      if (n && (!best || new Date(n.scheduledStart) < new Date(best.scheduledStart))) best = n
    }
    return best
  }, [node.groups])

  const locked = node.blocked

  return (
    <div className="mb-6 overflow-hidden rounded-3xl bg-[var(--color-bg-surface)]" style={CARD}>

      {/* ── the band: the module card's own artwork, at full width ──
          skin.wash runs 30% → 18% lightness, so it is darker than
          --color-bg-surface under BOTH themes (#FFFFFF / #12151F) and the
          light type on it holds. This is the same exception the module grid
          documents: fixed hsl on a guaranteed-dark ground. Everything below
          the band is tokens. */}
      <div className="relative h-32 overflow-hidden sm:h-40"
        style={{ background: skin.wash, filter: locked ? 'grayscale(0.7)' : undefined }}>
        <ModuleGeometry skin={skin} />

        {/* The geometry carries a light source that can brighten exactly where
            the title sits, so the type gets its own floor rather than trusting
            the wash to be dark in the right place. */}
        <span aria-hidden className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(2,6,16,0.55) 0%, rgba(2,6,16,0.12) 58%, rgba(2,6,16,0) 100%)' }} />

        <div className="absolute inset-0 flex items-end gap-4 p-4 sm:gap-6 sm:p-6">
          <span className="flex-shrink-0 leading-none">
            <span className="dm block text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ color: 'rgba(255,255,255,0.72)' }}>
              {position !== null ? 'Module' : 'Sessions'}
            </span>
            {position !== null ? (
              /* Not pure #FFF — the dark palette stops at #E8EAF0 to avoid
                 haloing, and a 64px numeral is exactly that case. */
              <span className="syne block text-[42px] font-extrabold leading-none tracking-tight sm:text-[64px]"
                style={{ color: 'rgba(255,255,255,0.95)' }}>
                {pad2(position)}
              </span>
            ) : (
              /* The general bucket has no number, and an empty column where one
                 should be is half of what made the old header read unfinished. */
              <span className="mt-2 flex h-11 w-11 items-center justify-center rounded-2xl sm:h-14 sm:w-14"
                style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)' }}>
                <Calendar size={22} strokeWidth={1.75} style={{ color: 'rgba(255,255,255,0.92)' }} />
              </span>
            )}
          </span>

          <h2 className="syne line-clamp-2 min-w-0 flex-1 text-[16px] font-extrabold leading-tight sm:text-[24px]"
            style={{ color: 'rgba(255,255,255,0.96)' }}>
            {titleCase(node.title)}
          </h2>
        </div>

        {locked && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{ background: 'rgba(15,23,42,0.55)', color: '#fff', backdropFilter: 'blur(6px)' }}>
            <Lock size={8} strokeWidth={2.5} />Locked
          </span>
        )}
      </div>

      {/* ── the shelf ── */}
      <div className="p-4 sm:p-5">
        {course.shared && (
          <span className="mb-2.5 inline-flex">
            <Pill icon={<Share2 size={9} strokeWidth={2.5} />} rgb={SHARED_RGB}>
              Shared with your academy
            </Pill>
          </span>
        )}

        {node.description && (
          <p className="max-w-[72ch] text-xs leading-relaxed sm:text-[13px]"
            style={{ color: 'var(--color-text-secondary)' }}>
            {node.description}
          </p>
        )}

        <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${node.description ? 'mt-4' : ''}`}>
          <StatTile accent icon={<Calendar size={13} strokeWidth={2} />}
            value={String(node.sessionCount)} label={node.sessionCount === 1 ? 'Session' : 'Sessions'} />
          <StatTile icon={<Globe size={13} strokeWidth={2} />}
            value={String(node.languages.length)} label={node.languages.length === 1 ? 'Language' : 'Languages'} />
          {/* "Weekly slots", not "Slots": the list below is dates now, and the
              one place the weekly series is still worth naming is here, where
              it says how many recurring cohorts this module runs. */}
          <StatTile icon={<Layers size={13} strokeWidth={2} />}
            value={String(node.groups.length)}
            label={node.groups.length === 1 ? 'Weekly slot' : 'Weekly slots'} />
          {/* "Mar 14", not "Tue, Mar 14": at 375px this tile is ~130px wide and
              the longer string truncated to "Tue, Mar…", which is the one form
              of the date that helps nobody. The weekday is on every card below. */}
          <StatTile icon={<Clock size={13} strokeWidth={2} />}
            value={soonest ? fmtMonthDay(soonest.scheduledStart) : '—'}
            label={soonest ? `Next · ${fmtTime(soonest.scheduledStart)}` : 'Nothing ahead'} />
        </div>

        {node.blocked && (
          <div className="mt-3.5 flex items-start gap-2 rounded-xl px-3 py-2.5"
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
    </div>
  )
}

/* ── The dated session card ─────────────────────────────────────────────────

   ONE CARD IS ONE DATED SESSION, AND THE CARD IS WHERE IT IS BOOKED.

   This screen used to list SLOT GROUPS — "Thursdays · 9:00 PM", one card per
   weekly cohort — and the booking happened one tap further in, inside a modal
   titled "Choose a time slot". Two screens to take a seat, and the first of
   them answered a question ("which weekly cohort?") that a student picking a
   date does not actually ask.

   So the middle step is gone. Sessions are listed as DATES, soonest first,
   banded under Today / Tomorrow / the day, and every action the modal owned
   now lives on the card: Book a seat, the join button, Cancel reservation,
   and — for each state that offers neither — the sentence that says why.

   THE SERIES DID NOT GO AWAY, ONLY ITS CARD. `hasOther` is still computed per
   GROUP and handed to getSlotStatus, so a student holding Thursday the 4th
   still sees Thursday the 11th LOCKED rather than bookable. Flattening the
   groups into one dated list must not quietly turn one-seat-per-series into
   four-seats-per-series: the API would refuse it, and the screen would have
   promised it.

   THE CARD IS NOT A BUTTON. Every other card on these three levels is one
   focusable element, because every other card does exactly one thing. This
   one can carry three controls at once — book, join, cancel — so it is a
   plain container with real buttons inside it, and it does NOT lift on hover:
   the lift is this app's signature for "the whole card is the action", and
   here it is not.
   ────────────────────────────────────────────────────────────────────────── */

/* THE FOCUS RING HAS TO BE SHOUTED DOWN, NOT SET.

   globals.css carries `:focus-visible:not(input):not(textarea):not(select) {
   outline: 2px solid var(--color-primary) !important }`, and an !important
   shorthand makes every longhand important — so a Tailwind
   `focus-visible:outline-[color:…]` utility never applies and every ring on
   this page renders #0057b8, which is 2.65:1 on the dark surface and fails
   WCAG 1.4.11. The ring has to be re-declared at equal weight to win, exactly
   as my-bookings/page.tsx already does with `.bk-focus`. The danger variant
   carries two classes so it outranks the base rule. */
const SHEET_CSS =
  '.cs-focus:focus-visible{outline:2px solid var(--color-primary-on-surface)!important;outline-offset:2px;border-radius:12px}' +
  '.cs-focus.cs-danger:focus-visible{outline-color:var(--color-danger)!important}'
// eslint-disable-next-line react/no-danger
const SheetStyle = () => <style dangerouslySetInnerHTML={{ __html: SHEET_CSS }} />

/** Is this session still ahead of the student, read on the SERVER-anchored
    clock rather than the device's?

    `isStillAhead` in lib/classSchedule is the same rule read off `Date.now()`;
    used here it would drop a card — and with it the join button — on a device
    running three minutes fast, for a class the student holds a seat in and
    could still join. The rule itself is unchanged: not cancelled, and not yet
    past its end. (`isStillAhead` is `!isPastEnd || isWithinLiveWindow`, and
    the live window ends at the same instant `isPastEnd` begins, so the two
    clauses reduce to this one comparison.) */
function isAheadAt(lc: LiveClass, now: number): boolean {
  return lc.status !== 'cancelled'
    && now < new Date(lc.scheduledStart).getTime() + (lc.durationMins || 60) * 60_000
}

/** "Sat 20 Sep" from a day bucket's own YYYY-MM-DD key. Built at noon UTC
    from the key's parts and formatted in UTC, so the weekday named is the
    key's weekday in every device zone — the same trick groupByDay uses for
    the days it labels itself. */
function keyDateLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(Date.UTC(y!, m! - 1, d!, 12)))
}

/** A FUTURE deadline, with its day attached: "8:00 PM today", "8:00 PM
    tomorrow", "Sep 24, 8:00 PM". A bare clock time was safe in the modal,
    which showed one slot at a time behind a tap; in a list three weeks long
    it reads as tonight. Dated off the server clock, like everything else. */
function fmtDeadline(ms: number, now: number): string {
  const iso = new Date(ms).toISOString()
  const key = zonedKey(new Date(ms))
  if (key === zonedKey(new Date(now)))              return `${fmtTime(iso)} today`
  if (key === zonedKey(new Date(now + 86_400_000))) return `${fmtTime(iso)} tomorrow`
  return `${fmtMonthDay(iso)}, ${fmtTime(iso)}`
}

/** A PAST deadline: "today at 8:00 PM" / "yesterday at 8:00 PM" / "on Sep 19
    at 8:00 PM". Missing a cut-off by ten minutes and missing it by a week are
    different facts and must not read the same — only one of those students
    should be emailing their admin. */
function fmtPassed(ms: number, now: number): string {
  const iso = new Date(ms).toISOString()
  const key = zonedKey(new Date(ms))
  if (key === zonedKey(new Date(now)))              return `today at ${fmtTime(iso)}`
  if (key === zonedKey(new Date(now - 86_400_000))) return `yesterday at ${fmtTime(iso)}`
  return `on ${fmtMonthDay(iso)} at ${fmtTime(iso)}`
}

/** One dated session with everything the card needs already decided: the
    weekly series it belongs to (for the one-per-series rule), the student's
    booking on it, and what they may do with it right now. */
interface DatedSession {
  lc:      LiveClass
  group:   ClassGroup
  booking: MyBooking | undefined
  status:  SlotStatus
}

/* ── The day band's head ────────────────────────────────────────────────── */

/** A REAL HEADING. The whole organising idea of this screen is that the day
    is the heading, so it has to be in the document's heading outline — a
    screen-reader user navigating by heading got nothing between the module
    hero and the end of the sheet while this was a styled <span>. h3, because
    ModuleHero's module title is the h2 above it. */
function DayHead({ bucket, headingId, reduce }: {
  bucket: DayBucket; headingId: string; reduce: boolean | null
}) {
  /* groupByDay labels every other day with its own date ("Wed, Sep 24"), so
     only Today and Tomorrow need one attached. */
  const needsDate = bucket.label === 'Today' || bucket.label === 'Tomorrow'
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <h3 id={headingId}
        className="syne flex min-w-0 items-baseline gap-2 text-[15px] font-extrabold tracking-tight"
        style={{ color: bucket.today ? 'var(--color-primary-on-surface, var(--color-primary))' : 'var(--color-text-primary)' }}>
        {bucket.today && (
          /* Emphasis by INK, not by tint. A tinted pill built from
             rgba(0,87,184,0.08) composites DARKER than the surface over the
             #0B0D14 page, so "today is the tinted one" reads backwards in the
             dark. A colour and a dot survive both themes. */
          <motion.span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 self-center rounded-full"
            style={{ background: 'var(--color-primary-on-surface, var(--color-primary))' }}
            animate={reduce ? undefined : { opacity: [1, 0.35, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} />
        )}
        <span className="truncate">{bucket.label}</span>
        {needsDate && (
          <span className="dm flex-shrink-0 text-[10.5px] font-semibold"
            style={{ color: 'var(--color-text-muted)' }}>{keyDateLabel(bucket.key)}</span>
        )}
      </h3>

      <span aria-hidden className="h-px min-w-[12px] flex-1" style={{ background: 'var(--color-border)' }} />

      <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.12em]"
        style={{ color: 'var(--color-text-muted)' }}>
        {plural(bucket.items.length, 'class', 'classes')}
      </span>
    </div>
  )
}

/* ── The card's action area ─────────────────────────────────────────────── */

/** Neutral ground for a state that is only a sentence. */
const NEUTRAL = { color: 'var(--color-text-muted)', bg: 'var(--color-bg-inset)', border: 'var(--color-border)' }

/** A state the card cannot act on, said in one line and explained in the
    next. The TINT is the status colour; the TYPE is tokens. A status-coloured
    sentence would be the largest piece of text on the card in the one colour
    not guaranteed to survive both themes — the same rule the slot card's
    'soft' CTA already followed. */
function ActionNote({ tint = NEUTRAL, icon, title, body }: {
  tint?: { color: string; bg: string; border: string }
  icon: React.ReactNode; title: string; body?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
      style={{ background: tint.bg, border: `1px solid ${tint.border}` }}>
      <span className="mt-[1px] flex-shrink-0" style={{ color: ink(tint.color) }}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11.5px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{title}</span>
        {body && (
          <span className="mt-0.5 block break-words text-[10.5px] leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}>{body}</span>
        )}
      </span>
    </div>
  )
}

/** The solid Delta blue every other screen uses for the one action it wants.
    White on #0057b8 — pinned in BOTH themes — so the ink is safe either way,
    which is not true of white on --color-danger (2.8:1 once dark lifts it to
    #F87171). The liveness is said by the badge and the rail instead. */
const PRIMARY_BTN = 'cs-focus flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold text-white outline-none transition-opacity hover:opacity-95 disabled:opacity-60'
const PRIMARY_STYLE: React.CSSProperties = {
  background: 'var(--color-primary)', boxShadow: '0 2px 8px rgba(0,87,184,0.25)',
}

/**
 * The way in, for a seat the student holds — and it NEVER renders nothing.
 *
 * JoinMeetButton returns null whenever the session is not join-eligible (in
 * person, in-app, no window on the payload, or a row whose `isBooked` has not
 * caught up with the bookings query yet), so a branch that is only the button
 * can leave a completely blank action area under a pulsing "Live Now" badge.
 * The modal never had that hole: it wrapped the button in a panel that stated
 * the phase in words. Every path below returns something.
 */
function JoinArea({ lc, now, held, live }: {
  lc: LiveClass; now: number; held: boolean; live: boolean
}) {
  const where = [lc.location, lc.room].filter(Boolean).join(' · ')

  /* In person — there is nothing to join; the room is the answer. The titles
     differ by context because the booked card has already said "Reserved" in
     a chip above this, and saying it twice is not reassurance. */
  if (lc.isOnline === false) {
    return (
      <ActionNote tint={SC.booked} icon={<MapPin size={12} strokeWidth={2} />}
        title={live ? 'On now — in person' : 'In person'}
        body={live
          ? (where ? <>Your seat is reserved. Go to <strong>{where}</strong>.</> : 'Your seat is reserved. Go to your classroom.')
          : (where ? <>This class is at <strong>{where}</strong>.</> : 'Your academy will tell you the room.')} />
    )
  }

  /* In-app (Mux). NO join email is ever sent for one of these — the
     scheduled-class mail carries the COURSE url, not a join link — so the
     card must not point at an inbox. The room is on this site. */
  if (lc.type === 'internal') {
    if (live) {
      return (
        <Link href={`/live-classes/${lc.id}/watch`} className={PRIMARY_BTN} style={PRIMARY_STYLE}>
          <Radio size={12} strokeWidth={2.5} />Join the class
        </Link>
      )
    }
    return (
      <ActionNote tint={SC.booked} icon={<Video size={12} strokeWidth={2} />}
        title="Plays in the app"
        body={<>This class runs <strong>here on the site</strong>. The Join button appears on this card when it starts.</>} />
    )
  }

  /* External (Google Meet). The link is released by the server between
     joinOpensAt and joinClosesAt, so the button decides from those two
     instants and never from the slot status — 'live' begins 15 minutes
     before the start and the link does not. */
  const session: JoinWindowSession = {
    /* Either source saying "booked" is enough. `lc.isBooked` comes from the
       live-classes query and `held` from the bookings query; useCreateBooking
       invalidates them independently, so for a moment after booking they
       disagree — and the one that says booked is the one this card is already
       drawing. The endpoint enforces the seat either way. */
    isBooked:     held || lc.isBooked === true,
    joinOpensAt:  lc.joinOpensAt,
    joinClosesAt: lc.joinClosesAt,
    type:         lc.type,
    isOnline:     lc.isOnline,
    status:       lc.status,
  }
  const phase = getJoinPhase(session, now)

  /* No window on the payload, or a row neither query has marked booked. The
     button would render nothing at all — which is fine on the booked card,
     where the chip and the email line above have already said where the
     student stands, and is NOT fine on a live one, where it would leave a
     pulsing "Live Now" badge over an empty action area. */
  if (phase === 'hidden') {
    if (!live) return null
    return (
      <ActionNote tint={SC.booked} icon={<Clock size={12} strokeWidth={2} />}
        title="Class is on now"
        body="Your seat is reserved. The join link is emailed shortly before class — if it has not arrived, contact your admin." />
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <JoinMeetButton
        sessionId={lc.id} now={now} size="md" accent="var(--color-primary)"
        {...session} className="w-full" />
      {phase === 'closed' && (
        <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          Your seat was reserved, but the join link has closed. If you are still
          expecting to attend, contact your admin.
        </p>
      )}
    </div>
  )
}

/** The recording, on a session that has finished. A working control the modal
    offered and both flattened drafts dropped. Reachable here because an
    instructor who ends a class early leaves `status: 'ended'` on a session
    still inside its scheduled window — exactly when the recording is newest. */
function RecordingLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="cs-focus mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[11.5px] font-semibold outline-none transition-colors"
      style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
      <Video size={12} strokeWidth={2} />Watch recording
    </a>
  )
}

/**
 * What the student may do with this session, right now. Ten states, each with
 * its own answer, and three that are easiest to lose: the in-person class
 * TODAY (no same-day booking, and no cancelling one you hold); the closed one
 * (says WHEN it closed); and the class in a course they have not bought
 * (offered an enrolment note, not a button the API would refuse).
 */
function SessionAction({
  s, shown, barred, sameDay, pendingReg, whenLabel, now, reduce,
  onBook, onCancel, bookPending, cancelPending,
}: {
  s:             DatedSession
  shown:         SlotStatus
  barred:        boolean
  sameDay:       boolean
  pendingReg:    boolean
  whenLabel:     string
  now:           number
  reduce:        boolean | null
  onBook:        (id: string) => Promise<void>
  onCancel:      (bookingId: string, label: string) => Promise<void>
  bookPending:   Set<string>
  cancelPending: Set<string>
}) {
  const { lc, group, booking } = s
  const offline = lc.isOnline === false
  const held    = booking?.status === 'booked' || booking?.status === 'attended'

  /* A MODULE THE ADMIN TURNED OFF still lists its sessions and still cannot
     book them — but it must give ONE answer, not two. The reason that stops
     the booking is the module; the fact the student also wants (when seats
     closed, that today is too late) rides in the same sentence rather than
     replacing it or being replaced by it.

     ONLY OVER THE STATES THAT WOULD OTHERWISE OFFER SOMETHING. A seat already
     held survives the module being turned off — the student keeps their join
     link and their cancel button — and a live class, an attendance and a
     recording are facts about what happened, not offers. `bookable` and
     `full` have already been downgraded to `locked` by the card. */
  if (barred && (shown === 'locked' || shown === 'closed')) {
    const extra =
        shown === 'closed' ? <> Seats for this date closed {fmtPassed(bookingClosedAt(lc), now)}.</>
      : sameDay            ? <> In-person seats also close the day before class.</>
      : null
    return (
      <ActionNote icon={<Lock size={12} strokeWidth={2} />}
        title="Module access is off"
        body={<>These sessions are listed so you can see what the module covers. Ask your admin to open it.{extra}</>} />
    )
  }

  switch (shown) {
    /* ── Live: the way in, never a booking button ── */
    case 'live': {
      if (!held) {
        return (
          <ActionNote tint={SC.live} icon={<Radio size={12} strokeWidth={2} />}
            title="Class is live now"
            body="Booking has closed. Only students who reserved beforehand receive a join link." />
        )
      }
      return <JoinArea lc={lc} now={now} held live />
    }

    /* ── The seat they hold ── */
    case 'booked': {
      const mins   = Math.max(0, Math.ceil((new Date(lc.scheduledStart).getTime() - now) / 60_000))
      const busy   = booking ? cancelPending.has(booking.id) : false
      /* Only an external online class gets a join link by email. */
      const mailed = !offline && lc.type === 'external'
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 rounded-xl px-3 py-2"
            style={{ background: SC.booked.bg, border: `1px solid ${SC.booked.border}` }}>
            <CheckCircle2 size={13} strokeWidth={2.5} className="flex-shrink-0" style={{ color: SC.booked.color }} />
            <span className="text-[11.5px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Reserved · {fmtTime(lc.scheduledStart)}
            </span>
          </div>

          {mailed && (
            <p className="flex items-start gap-1 text-[10.5px] leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}>
              <Clock size={10} strokeWidth={2} className="mt-[2px] flex-shrink-0" />
              {mins <= 5
                ? <span>Join link sent — check your inbox.</span>
                : <span>Your <strong>join link is emailed 5 min before</strong> class.</span>}
            </p>
          )}

          <JoinArea lc={lc} now={now} held live={false} />

          {/* An in-person class ON THE DAY cannot be given back — the room is
              already counted — so the button is not offered, exactly as the
              modal withheld it. */}
          {booking && !sameDay && (
            <button type="button"
              onClick={() => { void onCancel(booking.id, whenLabel) }}
              disabled={busy}
              className="cs-focus cs-danger flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[11.5px] font-semibold outline-none transition-colors hover:bg-[var(--color-hover-danger)] disabled:opacity-50"
              /* The LABEL is a token colour and the danger sits in the icon,
                 the hairline and the hover wash: --color-danger is #EF4444 on
                 white, 3.8:1, under the 4.5:1 this size needs. The control
                 still reads destructive; it also reads. */
              style={{ color: 'var(--color-text-secondary)', border: '1px solid rgba(239,68,68,0.22)' }}>
              {busy
                ? <Spinner size={11} variant="gray" />
                : <X size={11} strokeWidth={2.5} style={{ color: 'var(--color-danger)' }} />}
              {busy ? 'Cancelling…' : 'Cancel reservation'}
            </button>
          )}
        </div>
      )
    }

    /* ── The seat they can take ── */
    case 'bookable': {
      /* Not bought yet. The seat is real and the button would be refused, so
         the card says what is actually in the way. */
      if (lc.isEnrolled === false) {
        return (
          <ActionNote icon={<Lock size={12} strokeWidth={2} />}
            title="Enroll to reserve"
            body="Purchase this course to reserve seats and get email join links before class." />
        )
      }
      /* A student whose registration is still pending cannot hold a seat —
         POST /bookings answers PENDING_APPROVAL. Send them to the page that
         fixes it rather than to a button and a toast. */
      if (pendingReg) {
        return (
          <Link href="/complete-registration" className={PRIMARY_BTN} style={PRIMARY_STYLE}>
            <BookOpen size={12} strokeWidth={2.5} />Complete registration
          </Link>
        )
      }

      const busy = bookPending.has(lc.id)

      /* THE DEADLINE, BEFORE THEY NEED IT. A student who learns about the
         cut-off by being refused has already lost the seat.

         AND IT IS A DIFFERENT DEADLINE FOR AN IN-PERSON CLASS. getSlotStatus
         never consults bookingClosedAt on the offline path: an in-person
         session is bookable while its day offset is > 0 and locked the
         instant it reaches 0, i.e. at local midnight. Printing "Book by 8:00
         AM" on a class that stops being bookable eight hours earlier is the
         card contradicting the lock it is about to enforce. */
      let deadline: React.ReactNode
      let urgent = false
      if (offline) {
        deadline = offlineDayOffset(lc.scheduledStart) === 1
          ? <span>Book <strong>today</strong> — in-person seats close at midnight</span>
          : <span>In-person seats close at midnight the day before</span>
      } else {
        const closesAt = bookingClosedAt(lc)
        const minsLeft = Math.round((closesAt - now) / 60_000)
        if (minsLeft <= 0) {
          /* getSlotStatus reads Date.now() and this line reads the server
             clock, so the two can straddle the cut-off. Flooring a negative
             remainder to "Closes in 1 min" turns that skew into a false
             alarm; saying it is closing now does not. */
          urgent = true
          deadline = <span>Closing now — reserve immediately</span>
        } else if (minsLeft <= 120) {
          urgent = true
          deadline = (
            <span>Closes in <strong>{minsLeft < 60 ? `${minsLeft} min` : `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`}</strong></span>
          )
        } else {
          deadline = <span>Book by <strong>{fmtDeadline(closesAt, now)}</strong></span>
        }
      }

      return (
        <div>
          <motion.button type="button"
            onClick={() => { void onBook(lc.id) }}
            disabled={busy}
            whileHover={reduce || busy ? undefined : { scale: 1.015 }}
            whileTap={reduce || busy ? undefined : { scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className={PRIMARY_BTN} style={PRIMARY_STYLE}>
            {busy
              ? <><Spinner size={12} variant="white" />Reserving…</>
              : <><BookOpen size={12} strokeWidth={2.5} />Book a seat</>}
          </motion.button>

          {/* AMBER IS THE ICON, NOT THE WORDS. --color-warning is #F59E0B, a
              FILL value: as 10px ink on white it is ~2.1:1, and this is the
              one line whose entire purpose is to be read in the last two
              hours. The tint carries the urgency, the tokens carry the text. */}
          <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-[10px] font-semibold"
            style={{ color: urgent ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
            <Clock size={9} strokeWidth={2.25} className="flex-shrink-0"
              style={{ color: urgent ? 'var(--color-warning)' : undefined }} />
            {deadline}
          </p>
        </div>
      )
    }

    /* ── The states that only explain themselves ── */
    case 'closed':
      return (
        <ActionNote icon={<Clock size={12} strokeWidth={2} />}
          title="Booking closed"
          body={<>Seats closed <strong>{fmtPassed(bookingClosedAt(lc), now)}</strong>. Ask your admin if you still need a place.</>} />
      )

    case 'full':
      return (
        <ActionNote tint={SC.full} icon={<Users size={12} strokeWidth={2} />}
          title="Fully booked"
          body={lc.seatsLeftForYou != null
            ? 'Your academy has no seats left on this date.'
            : 'Every seat on this date is taken.'} />
      )

    case 'locked': {
      if (sameDay) {
        return (
          <ActionNote icon={<Lock size={12} strokeWidth={2} />}
            title="Same-day registration closed"
            body={<>In-person seats must be booked <strong>at least a day ahead</strong>. Pick a later date.</>} />
        )
      }
      /* NAME THE SEAT THEY ALREADY HOLD. The modal answered this structurally
         — it opened on the student's own reservation with the cancel button
         under it — and "cancel your other seat" is useless advice in a list
         interleaving every cohort of the module across three weeks. */
      const other = group.bookedSlot
      return (
        <ActionNote icon={<AlertCircle size={12} strokeWidth={2} />}
          title="One seat per weekly slot"
          body={other
            ? <>You are booked on <strong>{fmtDate(other.scheduledStart)} · {fmtTime(other.scheduledStart)}</strong>. Cancel that one to move to this date.</>
            : 'You already hold a seat in this weekly series. Cancel it to move to this date.'} />
      )
    }

    case 'attended':
      return (
        <div>
          <ActionNote tint={SC.attended} icon={<CheckCircle2 size={12} strokeWidth={2.5} />}
            title="Attended" body="You were marked present for this session." />
          {lc.recordingUrl && <RecordingLink url={lc.recordingUrl} />}
        </div>
      )

    case 'missed':
      return (
        <div>
          <ActionNote tint={SC.missed} icon={<AlertCircle size={12} strokeWidth={2} />}
            title="Missed" body="This session ran and you were not marked present." />
          {lc.recordingUrl && <RecordingLink url={lc.recordingUrl} />}
        </div>
      )

    /* 'cancelled' cannot reach this component — buildCatalog filters through
       isStillAhead, whose first clause drops it — and 'ended' arrives only
       when an instructor ends a class early, inside its scheduled window.
       Both are answered here rather than left to fall through to nothing. */
    default:
      return (
        <div>
          <ActionNote tint={SC[shown]} icon={<Calendar size={12} strokeWidth={2} />}
            title={shown === 'cancelled' ? 'Cancelled' : 'Session ended'}
            body={shown === 'cancelled'
              ? 'The academy cancelled this session.'
              : 'This one has finished.'} />
          {shown !== 'cancelled' && lc.recordingUrl && <RecordingLink url={lc.recordingUrl} />}
        </div>
      )
  }
}

/* ── The session card ───────────────────────────────────────────────────── */

function SessionCard({
  s, dayLabel, blocked, pendingReg, index, now,
  onBook, onCancel, bookPending, cancelPending,
}: {
  s:           DatedSession
  /** "Today" / "Tomorrow" / "Wed, Sep 24" — the band this card sits under,
      reused in the cancel toast so the confirmation names the date the
      student actually read. */
  dayLabel:    string
  blocked:     boolean
  pendingReg:  boolean
  index:       number
  now:         number
  onBook:      (id: string) => Promise<void>
  onCancel:    (bookingId: string, label: string) => Promise<void>
  bookPending: Set<string>
  cancelPending: Set<string>
}) {
  const { lc, group, status } = s
  const reduce = useReducedMotion()

  const offline = lc.isOnline === false
  /* The in-person day rule, read once and used for both halves of it.
     Deliberately computed with offlineDayOffset — the same device-zone reader
     getSlotStatus uses — so the card's copy can never contradict the status
     it is explaining. */
  const sameDay = offline && offlineDayOffset(lc.scheduledStart) === 0

  /* A module the admin turned off still LISTS its sessions and cannot book
     them. Read per SESSION as well as per module: buildCatalog marks a module
     blocked only when EVERY session in it is barred, so a mixed module would
     otherwise offer a Book button the API answers MODULE_BLOCKED to. */
  const barred = blocked || (lc.isEnrolled === true && lc.isEntitled === false)

  /* The badge must not say "Open" over a seat that cannot be taken. Only the
     two states that promise one are downgraded; a seat already held, a live
     class and every past state still say exactly what they are. */
  const shown: SlotStatus = barred && (status === 'bookable' || status === 'full') ? 'locked' : status
  const c = SC[shown]

  const cap   = lc.sessionCapacity
  const left  = Math.max(0, seatsLeft(lc))
  /* CROSS-ACADEMY: on a shared class seatsLeft() is the caller's own
     allocation, not the room's remainder, so `cap - left` is not "seats
     taken" and the ratio would lie. The count stays; only the meter goes. */
  const yours = lc.seatsLeftForYou != null
  /* Only on the states a seat count can still act on. "4 of 12 seats left"
     directly under "Booking closed" tells a student seats remain immediately
     below the sentence explaining they cannot have one. */
  const showSeats = !barred && cap > 0 && (shown === 'bookable' || shown === 'full' || shown === 'booked')
  const taken  = Math.min(100, Math.max(0, Math.round(((cap - left) / cap) * 100)))
  const scarce = left > 0 && left <= 3

  const where    = [lc.location, lc.room].filter(Boolean).join(' · ')
  const language = lc.language
  const time     = fmtTime(lc.scheduledStart)
  /* The same shape the flat list's toast uses — "Tomorrow, 9:00 PM". */
  const whenLabel = `${dayLabel}, ${time}`

  return (
    /* A PLAIN CONTAINER, not a button — see the note at the top of the level.
       <article> rather than <div> so the aria-label actually names something:
       a bare div carrying a label is not exposed, and without it a screen
       reader gets the clock, the title and the chips as loose text with no
       boundary between one session and the next.

       The entry delay lives INSIDE the animate target. As a sibling
       `transition` prop framer applies it to every gesture animation too, and
       written after a spread it also replaces the spring. The barred dim is
       in the target for the same reason it cannot be in `style`: framer
       writes its own latestValues over the style prop, so `opacity: 0.85`
       there is silently discarded by the entry animation landing on 1. */
    <motion.article
      aria-label={`${dayLabel} at ${time}, ${titleCase(lc.title)}${group.instructor ? `, ${group.instructor.name}` : ''} — ${c.label}`}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{
        opacity: barred ? 0.85 : 1, y: 0,
        transition: reduce ? { duration: 0 } : { ...spring, delay: Math.min(index, 10) * 0.035 },
      }}
      style={CARD}
      className="dm relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl bg-[var(--color-bg-surface)]">

      {/* Four pixels of the one colour that answers "can I have this?", so a
          day's grid can be read down its left edge before a word is. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1"
        style={{ background: c.color, opacity: shown === 'bookable' || shown === 'live' || shown === 'booked' ? 1 : 0.45 }} />

      <div className="flex flex-1 flex-col gap-2 p-3.5 pl-4">

        {/* ── the clock, and what state it is in ── */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="syne truncate text-[20px] font-extrabold leading-none tracking-tight"
              style={{ color: 'var(--color-text-primary)' }}>
              {time}
            </p>
            {/* No date here: the heading above the grid already carries it,
                and "Sep 20" under a band reading "Today · Sat 20 Sep" is the
                same fact twice, on every card on the screen. */}
            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: 'var(--color-text-muted)' }}>
              <Clock size={10} strokeWidth={2.25} className="flex-shrink-0" />
              {lc.durationMins || 60} min
            </p>
          </div>

          <span className="flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: c.bg, color: ink(c.color), border: `1px solid ${c.border}` }}>
            {shown === 'live' && (
              <motion.span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }}
                animate={reduce ? undefined : { opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
            )}
            {c.label}
          </span>
        </div>

        {/* ── which class this is ── */}
        <p className="line-clamp-2 text-[12.5px] font-bold leading-snug"
          style={{ color: 'var(--color-text-secondary)' }}>
          {titleCase(lc.title)}
        </p>

        {/* ── language, and where it happens ──
            Pill is the file's own chip; the delivery one is hand-rolled only
            because a room code has to be able to truncate, which needs the
            min-w-0 flex child Pill does not take. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {language && (
            <Pill rgb="14,204,142" solid="var(--color-success)" icon={<Globe size={9} strokeWidth={2.5} />}>
              {language}
            </Pill>
          )}
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={offline
              ? { background: 'rgba(0,87,184,0.08)', color: 'var(--color-primary-on-surface, var(--color-primary))', border: '1px solid rgba(0,87,184,0.20)' }
              : { background: 'rgba(99,102,241,0.08)', color: '#6366F1', border: '1px solid rgba(99,102,241,0.20)' }}>
            {offline
              ? <MapPin size={9} strokeWidth={2.5} className="flex-shrink-0" />
              : <Video size={9} strokeWidth={2.5} className="flex-shrink-0" />}
            <span className="truncate">{offline ? (where || 'In person') : 'Online'}</span>
          </span>
        </div>

        {/* ── who is teaching ── */}
        <div className="flex items-center gap-2">
          {group.instructor ? (
            <>
              <AvatarImg src={group.instructor.avatarUrl} name={group.instructor.name}
                className="h-5 w-5 flex-shrink-0 rounded-full object-cover"
                fallbackClassName="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
                fallbackStyle={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold"
                style={{ color: 'var(--color-text-secondary)' }}>{group.instructor.name}</span>
            </>
          ) : (
            <span className="text-[11.5px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
              Instructor to be announced
            </span>
          )}
        </div>

        {/* ── what is left of it ── */}
        {showSeats && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 truncate text-[10.5px] font-bold"
                style={{ color: scarce ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
                {scarce && <Users size={10} strokeWidth={2.5} className="flex-shrink-0" style={{ color: 'var(--color-warning)' }} />}
                {left === 0
                  ? 'No seats left'
                  : yours
                    ? `${left} ${left === 1 ? 'seat' : 'seats'} left for your academy`
                    : `${left} of ${cap} seats left`}
              </span>
              {!yours && (
                <span className="flex flex-shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <Users size={9} strokeWidth={2.5} />{cap - left} booked
                </span>
              )}
            </div>
            {!yours && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}>
                <motion.span className="block h-full rounded-full"
                  initial={reduce ? false : { width: 0 }} animate={{ width: `${taken}%` }}
                  transition={reduce ? { duration: 0 } : { ...spring, delay: 0.1 + Math.min(index, 10) * 0.035 }}
                  style={{ background: left === 0 ? 'var(--color-text-muted)' : scarce ? 'var(--color-warning)' : 'var(--color-primary)' }} />
              </div>
            )}
          </div>
        )}

        {/* ── THE PART THE MODAL USED TO OWN ── */}
        <div className="mt-auto pt-1">
          <SessionAction
            s={s} shown={shown} barred={barred} sameDay={sameDay}
            pendingReg={pendingReg} whenLabel={whenLabel} now={now} reduce={reduce}
            onBook={onBook} onCancel={onCancel}
            bookPending={bookPending} cancelPending={cancelPending} />
        </div>
      </div>
    </motion.article>
  )
}

/* ── The sheet ──────────────────────────────────────────────────────────── */

/** A label with a rule running off it to the edge of the grid. The language
    heading used to be three small words floating in a very wide column; the
    rule is what makes it read as the head of the band under it. */
function SectionHead({ icon, label, note }: {
  icon?: React.ReactNode; label: string; note?: string
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-[12px] font-bold"
        style={{ color: 'var(--color-text-primary)' }}>
        {icon}{label}
      </span>
      {note && (
        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: 'var(--color-text-muted)' }}>{note}</span>
      )}
      <span aria-hidden className="h-px min-w-[16px] flex-1" style={{ background: 'var(--color-border)' }} />
    </div>
  )
}

/** One row of filter chips. Rendered only when there is something to choose
    between — see showFacet. */
function FilterRow({ icon, label, options, value, onChange }: {
  icon: React.ReactNode
  label: string
  options: { id: string; label: string; avatarUrl?: string }[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]"
        style={{ color: 'var(--color-text-muted)' }}>
        {icon}{label}
      </span>

      {/* "All" first and always present, so clearing a choice is one tap and
          never requires knowing that tapping the active chip would do it. */}
      {[{ id: '', label: 'All' }, ...options].map(o => {
        const on = (o.id || null) === value
        return (
          <button key={o.id || '__all'} type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id || null)}
            className="dm inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary-on-surface,var(--color-primary))]"
            style={on
              ? { background: 'rgba(0,87,184,0.10)', border: '1px solid rgba(0,87,184,0.30)', color: 'var(--color-primary-on-surface, var(--color-primary))' }
              : { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
            {o.avatarUrl !== undefined && (
              <AvatarImg src={o.avatarUrl} name={o.label}
                className="h-4 w-4 flex-shrink-0 rounded-full object-cover"
                fallbackClassName="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[7px] font-bold"
                fallbackStyle={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }} />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function ModuleSheet({
  course, node, position, bookingMap, search, now,
  onBook, onCancel, bookPending, cancelPending, onNavigate,
}: {
  course:        CourseNode
  node:          ModuleNode
  position:      number | null
  bookingMap:    Map<string, MyBooking>
  search:        string
  /** The server-anchored clock from useJoinClock — it ticks every second
      while a booked session is near a join boundary and every 30 s
      otherwise, so the join button appears on the start second without a
      reload and the countdowns move on their own. */
  now:           number
  onBook:        (id: string) => Promise<void>
  onCancel:      (bookingId: string, label: string) => Promise<void>
  bookPending:   Set<string>
  cancelPending: Set<string>
  onNavigate:    (courseId: string | null, moduleId: string | null) => void
}) {
  const q = search.trim().toLowerCase()
  const reduce = useReducedMotion()

  /* A student whose registration is still pending cannot hold a seat — the
     booking endpoint answers PENDING_APPROVAL — so the card sends them to
     finish registering rather than to a button that will be refused. This is
     the one fetch on this level, and it is the query the whole app already
     shares: one cache entry, no second request. */
  const { data: me } = useCurrentUser()
  const pendingReg = me?.enrollmentStatus === 'pending'

  const [language, setLanguage] = useState<string | null>(null)
  const [tutorId,  setTutorId]  = useState<string | null>(null)

  /* Reset when the module changes. Without this, walking from a module taught
     in Hindi to one that is English-only would carry `language: 'Hindi'`
     across and show an empty screen for a module that has sessions. */
  useEffect(() => { setLanguage(null); setTutorId(null) }, [node.id])

  /* THE LIST IS DERIVED ON A MINUTE, NOT ON A SECOND. `now` ticks once a
     second while any booked session is within two minutes of a join
     boundary; nothing in this derivation changes faster than a minute, and
     re-flattening four dozen sessions at 1 Hz to get the same array back is
     work nobody sees. The join buttons still read the raw `now`. */
  const nowMin = Math.floor(now / 60_000)

  /* The search box stays on screen at every level, so it has to mean
     something at every level. Here it matches the class title, the instructor
     and the language — the three things that tell one session of a module
     from another once the date is on the card. */
  const searched = useMemo(
    () => q
      ? node.groups.filter(g =>
          g.title.toLowerCase().includes(q) ||
          (g.instructor?.name ?? '').toLowerCase().includes(q) ||
          ((g.slots[0] as { language?: string } | undefined)?.language ?? '').toLowerCase().includes(q))
      : node.groups,
    [node.groups, q],
  )

  /* THE TIME CUT RUNS BEFORE THE FACETS, NOT AFTER.
     A filter must never offer a value that comes back empty — and once the
     rendered unit is a SESSION rather than a group, a group whose last
     session ended while the sheet was open is exactly such a value. So the
     options are computed from the groups that still have something ahead. */
  const live = useMemo(
    () => searched.filter(g => g.slots.some(lc => isAheadAt(lc, now))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searched, nowMin],
  )

  const facets = useMemo(() => moduleFacets(live), [live])
  const showLang  = showFacet(facets.languages)
  const showTutor = showFacet(facets.instructors)

  /* A chip that is no longer offered must not keep filtering from off-screen. */
  useEffect(() => {
    if (language && !facets.languages.includes(language)) setLanguage(null)
    if (tutorId  && !facets.instructors.some(i => i.id === tutorId)) setTutorId(null)
  }, [facets, language, tutorId])

  const groups = useMemo(
    () => filterGroups(live, showLang ? language : null, showTutor ? tutorId : null),
    [live, language, tutorId, showLang, showTutor],
  )

  /* ── FROM WEEKLY SLOTS TO A RUN OF DATES ──

     The grouping survives as a computation and disappears as a screen: every
     session of every surviving group is flattened into one list and banded by
     the student's own calendar day.

     `hasOther` is read off the GROUP on the way past, which is the whole
     reason the groups are still built. It is the one-seat-per-weekly-series
     rule, and flattening it would silently have let a student book all four
     Thursdays.

     groupByDay does the banding: it is already in lib/classSchedule, already
     unit-tested, and it takes the SERVER clock, so "Today" cannot be
     relabelled by a device that is a day out. It also names every other day
     with its own date — a twelve-week Thursday cohort gets twelve distinct
     headings rather than the word "Thursday" twelve times. */
  const { buckets, rows } = useMemo(() => {
    const byId = new Map<string, DatedSession>()
    const ahead: LiveClass[] = []
    for (const g of groups) {
      const heldId = g.bookedSlot?.id
      for (const lc of g.slots) {
        /* The catalogue is not a diary. buildCatalog already dropped what is
           behind us, but this re-runs as the clock moves, so a session that
           finishes while the sheet is open leaves the list instead of sitting
           at the top of Today offering a seat in the past. */
        if (!isAheadAt(lc, now)) continue
        const booking = bookingMap.get(lc.id)
        byId.set(lc.id, {
          lc, group: g, booking,
          status: getSlotStatus(lc, booking, !!heldId && heldId !== lc.id),
        })
        ahead.push(lc)
      }
    }
    return { buckets: groupByDay(ahead, now), rows: byId }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, bookingMap, nowMin])

  /* BOTH NUMBERS OFF THE SAME CLOCK. node.sessionCount is frozen at the last
     refetch, so pairing it with a live count made a session ending while the
     sheet was open read "5 of 12" and then "4 of 12". */
  const shownCount = rows.size
  const totalCount = useMemo(
    () => node.groups.reduce((n, g) => n + g.slots.filter(lc => isAheadAt(lc, now)).length, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.groups, nowMin],
  )
  const narrowed = shownCount !== totalCount

  /* SMALL BOXES, in a grid that does not change shape between days — a card
     one day wide and a card three days narrow would make the column of days
     read as three different screens. Each card carries its own controls now,
     so three across is the widest that keeps a button a comfortable target. */
  const cols = 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'

  /* The stagger runs across the WHOLE sheet, not per day, so the cascade
     reads top to bottom instead of restarting at every heading. */
  let seq = -1

  return (
    <motion.div {...enter} transition={spring} key={`m:${course.id}:${node.id}`}>
    {/* ONE child, deliberately. framer re-creates this element with its
        children as a plain array, and React demands keys from an array of
        children — a static JSX child list normally escapes that via the `jsxs`
        fast path, but the mark does not survive the round trip. A Fragment
        collapses them to one child and adds no DOM node. */}
    <>
      <SheetStyle />

      <BackLink label={titleCase(course.title)} onClick={() => onNavigate(course.id, null)} />
      <Crumbs trail={[
        { label: 'Courses', onClick: () => onNavigate(null, null) },
        { label: titleCase(course.title), onClick: () => onNavigate(course.id, null) },
        { label: titleCase(node.title) },
      ]} />

      <ModuleHero node={node} position={position} course={course} />

      <SectionHead
        icon={<Calendar size={12} strokeWidth={2.25} style={{ color: 'var(--color-primary-on-surface, var(--color-primary))' }} />}
        label="Upcoming sessions"
        note={narrowed ? `${shownCount} of ${totalCount}` : plural(totalCount, 'session')}
      />

      {/* ── FILTERS ──

          Each row appears only when it would actually narrow something. A
          module taught by one instructor does not get an instructor filter:
          a control whose every option returns the same list is furniture,
          and on a screen this small it is furniture in the way. The same
          rule drops the language row on a single-language module. */}
      {(showLang || showTutor) && (
        <div className="mb-4 flex flex-col gap-2 rounded-2xl px-3 py-2.5"
          style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}>
          {showLang && (
            <FilterRow
              icon={<Globe size={11} strokeWidth={2.5} style={{ color: 'var(--color-success)' }} />}
              label="Language" value={language} onChange={setLanguage}
              options={facets.languages.map(l => ({ id: l, label: l }))} />
          )}
          {showTutor && (
            <FilterRow
              icon={<User size={11} strokeWidth={2.5} style={{ color: 'var(--color-primary-on-surface, var(--color-primary))' }} />}
              label="Instructor" value={tutorId} onChange={setTutorId}
              options={facets.instructors.map(i => ({ id: i.id, label: i.name, avatarUrl: i.avatarUrl }))} />
          )}
        </div>
      )}

      {buckets.length === 0 ? (
        <Empty icon={<Calendar size={26} style={{ color: 'var(--color-primary)' }} />}
          title={q || language || tutorId ? 'No sessions match' : 'Nothing scheduled yet'}
          body={q || language || tutorId
            ? 'Try a different filter, or clear them to see every date.'
            : 'This module has no upcoming sessions. Check back soon.'} />
      ) : (
        <div className="flex flex-col gap-7">
          {buckets.map(bucket => {
            const headingId = `day-${node.id || 'general'}-${bucket.key}`
            return (
              <section key={bucket.key} aria-labelledby={headingId}>
                <DayHead bucket={bucket} headingId={headingId} reduce={reduce} />
                <div className={`grid gap-3.5 ${cols}`}>
                  {bucket.items.map(lc => {
                    const s = rows.get(lc.id)
                    if (!s) return null
                    seq += 1
                    return (
                      <SessionCard key={lc.id} s={s} dayLabel={bucket.label}
                        blocked={node.blocked} pendingReg={pendingReg}
                        index={seq} now={now}
                        onBook={onBook} onCancel={onCancel}
                        bookPending={bookPending} cancelPending={cancelPending} />
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
    </motion.div>
  )
}

/* ── The view ───────────────────────────────────────────────────────────── */

export function Hierarchy({
  classes, bookingMap, search, courseId, moduleId, onNavigate,
  onBook, onCancel, bookPending, cancelPending,
}: {
  classes:     LiveClass[]
  bookingMap:  Map<string, MyBooking>
  search:      string
  courseId:    string | null
  moduleId:    string | null
  onNavigate:  (courseId: string | null, moduleId: string | null) => void
  /* The page's own booking handlers, unchanged: it owns the mutations and the
     seven error codes they can come back with, and the cards below call
     straight into them. Level 3 gained the controls, not the error handling. */
  onBook:        (id: string) => Promise<void>
  onCancel:      (bookingId: string, label: string) => Promise<void>
  bookPending:   Set<string>
  cancelPending: Set<string>
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

  /* THE CLOCK LIVES HERE, NOT ON THE PAGE.

     Level 3 books, so it needs the server-anchored clock the join button
     reads — and it needs it to tick to the second inside a join window. Held
     at this level rather than in page.tsx, that 1 Hz tick re-renders the
     module sheet instead of the whole 2000-line schedule page, and it is
     scoped to the OPEN MODULE's sessions, so levels 1 and 2 never leave the
     30 s tick at all. `undefined` outside level 3 means exactly that. */
  const clockSessions = useMemo(
    () => (mod ? mod.groups.flatMap(g => g.slots) : undefined),
    [mod],
  )
  const now = useJoinClock(clockSessions)

  /* ── Level 3 ── */
  if (course && mod) {
    const position = mod.id === GENERAL
      ? null
      : course.modules.filter(m => m.id !== GENERAL).indexOf(mod) + 1
    /* `search` goes in RAW: ModuleSheet owns its own normalisation so it can
       be dropped anywhere without a caller remembering to trim it. */
    return (
      <ModuleSheet course={course} node={mod} position={position} bookingMap={bookingMap}
        search={search} now={now} onNavigate={onNavigate}
        onBook={onBook} onCancel={onCancel}
        bookPending={bookPending} cancelPending={cancelPending} />
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
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

