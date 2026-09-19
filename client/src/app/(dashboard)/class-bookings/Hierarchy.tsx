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

import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  BookOpen, ChevronRight, Globe, Layers, Lock, Users, Clock,
  Share2, Calendar, ArrowLeft, Radio, MapPin, Check,
} from 'lucide-react'
import type { LiveClass } from '@/lib/api/liveClasses'
import type { MyBooking } from '@/lib/api/bookings'
import { titleCase } from '@/lib/titleCase'
import { AvatarImg } from '@/components/ui/AvatarImg'
import {
  getSlotStatus, SC, seatsLeft, slotPattern, nextSlot, isPastEnd,
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


/* ── Level 1 — the courses ───────────────────────────────────────────────

   THE COVER IS A LAYER, NOT A CASE.

   Some courses have artwork and some never will — and `buildCatalog` makes
   that structural, not accidental: `thumbnailUrl` is deliberately dropped for
   every SHARED course, so a guest's card can NEVER have a photo. The old card
   made that the student's problem: a photographed course sat beside a grey box
   with a cap floating in it, which reads as a broken image rather than a cover.

   So the ground is ALWAYS the generated delta banner the module cards use —
   same FNV-1a hash, same six hues, same four motifs, same hairline — and the
   cover, when there is one, is a layer on top of it. A course with a photo and
   a course without are the same card with one layer switched off: same wash,
   same geometry, same scrim, same hairline, same numeral, same hover. Nothing
   in the row reads as a fallback, and a cover that 404s falls back to the
   designed banner instead of leaving a hole.

   The ring position is hashed from the course id, not taken from `index`,
   because `index` is the position in the FILTERED grid: seeding off it would
   repaint every banner in the grid as the student types in the search box. A
   module's number is its place in the course and a course's colour is a
   property of the course — neither is a property of your search results.
   ──────────────────────────────────────────────────────────────────────── */

/** `level` arrives as free text — the admin typed it by hand for years before
    it became a select, so it shows up as 'Beginner', 'BEGINNER', 'beginner'
    and as things that are none of the three. The three we can draw a meter for
    are matched case-insensitively and rendered from the canonical map (NOT
    through `titleCase`, which preserves deliberate capitals and would leave
    'BEGINNER' shouting); anything else is still shown as a word rather than
    thrown away. */
const LEVEL_RUNGS: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 }
const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
}

/** How an uploaded cover composites onto its generated banner.

    'normal'     — the photo keeps its own colours; the banner supplies the
                   hue only through the eyebrow, the hairline and a 10% veil.
    'luminosity' — duotone: the photo supplies the light and the banner the
                   colour, so every cover renders in its card's hue.

    'normal' is the default because a cover is content an academy chose to
    upload, and silently recolouring it is destructive. The lightness clamp
    below — not the blend — is what keeps a blown-out photo from landing two
    stops brighter than the generated banners beside it. Flip this one constant
    to see the whole grid duotone. */
const COVER_BLEND: 'normal' | 'luminosity' = 'normal'

/** Structurally a `CourseNode`, widened only where the card is tolerant:
    `modules` is counted, never read into, and `level` is free text. */
interface CourseCardNode {
  id:            string
  title:         string
  program?:      string
  thumbnailUrl?: string
  description?:  string
  level?:        string
  shared:        boolean
  modules:       unknown[]
  sessionCount:  number
}

/** Three bars, n of them lit. A level reads faster as a shape than as a word,
    and a shape survives being 10px tall on a banner where a word would not —
    the word is still beside it for everyone who is not skimming. */
function LevelMeter({ rungs }: { rungs: number }) {
  return (
    <span aria-hidden className="flex items-end gap-[2px]">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-[3px] rounded-[1px]"
          style={{ height: 4 + i * 3, background: '#fff', opacity: i < rungs ? 0.95 : 0.32 }} />
      ))}
    </span>
  )
}

function CourseCard({ node, index, onOpen }: {
  node: CourseCardNode; index: number; onOpen: () => void
}) {
  const moduleCount = node.modules.length
  const empty       = node.sessionCount === 0

  const raw    = node.level?.trim() ?? ''
  const key    = raw.toLowerCase()
  const rungs  = LEVEL_RUNGS[key] ?? 0
  const level  = raw ? (LEVEL_LABEL[key] ?? titleCase(raw)) : null

  /* A cover that fails to load is remembered BY URL rather than as a boolean,
     so the layer comes back by itself if the course is later given a working
     one — no effect, no stale `true` pinned to a new src. */
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const cover = node.thumbnailUrl && node.thumbnailUrl !== failedSrc ? node.thumbnailUrl : null

  /* The course's own hash picks its stop in the ring; the programme seeds
     where that ring starts, so one programme's courses read as one slice of
     the six hues and another programme's as a different slice. Pure FNV-1a,
     so the server and the browser paint the same card. */
  const skin = useMemo(
    () => moduleSkin(node.id, node.title, moduleHash(node.id || node.title) % 6, node.program ?? 'delta'),
    [node.id, node.title, node.program],
  )

  const label = [
    titleCase(node.title),
    ' — ', plural(moduleCount, 'module'), ', ',
    empty ? 'nothing scheduled' : plural(node.sessionCount, 'upcoming session'),
    level ? `, ${level}` : '',
    node.shared ? ', shared with your academy' : '',
  ].join('')

  /* Capped: a 40-course catalogue would otherwise take 1.6s to finish
     arriving, and the last card would animate in long after the student had
     started reading the first. Twelve cards is more than one screen. */
  const delay = Math.min(index, 11) * 0.04

  return (
    /* ONE focusable element, as ModuleCard is. The CTA below is a span that
       looks like a button — a real button nested in this one would be invalid
       HTML and would cost a second tab stop per card: five cards to a row,
       ten tab stops to cross a grid.

       `outline-none` holds a transparent 2px outline at rest so the focus ring
       costs no layout when it appears, and the colour is `primary-on-surface`
       (#6ba6ff in dark) rather than `--color-primary`, which is the same
       #0057b8 in both themes and would be nearly invisible against #12151F.
       An outline rather than the button component's ring, because
       `ring-offset` paints a band in a fixed colour and would draw a white
       halo around every focused card in dark mode.

       The stagger lives inside the `animate` target's own transition, NOT in a
       top-level `transition` prop: a top-level one would replace cardHover's
       350/28 spring and apply the entry delay to hover and tap, so the tenth
       card in the grid would sit still for 400ms after the cursor arrived. */
    <motion.button type="button" onClick={onOpen}
      {...cardHover}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { ...spring, delay } }}
      style={CARD}
      aria-label={label}
      className="dm group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-primary-on-surface,var(--color-primary))]">

      {/* ── the banner ── */}
      <div className="relative aspect-video w-full flex-shrink-0 overflow-hidden"
        style={{ background: skin.wash }}>

        {/* One layer carries the ground AND the cover, so both cases move
            identically on hover.

            `isolate` is load-bearing rather than decorative: `group-hover:
            scale` opens a stacking context the moment the cursor arrives, so
            without an isolation of its own a blended cover would resolve
            against the page at rest and against this box on hover, and the
            photograph would visibly jump the first time you pointed at it. */}
        <div className="absolute inset-0 isolate transition-transform duration-[600ms] ease-out group-hover:scale-[1.06]"
          style={{ background: skin.wash }}>
          <ModuleGeometry skin={skin} />

          {cover && (
            <>
              {/* The clamp, not the blend, is what makes a photographed card
                  and a generated one siblings: measured against a deliberately
                  blown-out test image, an unclamped cover lands two lightness
                  stops above every banner beside it and the row stops reading
                  as a set. */}
              <img src={cover} alt="" loading="lazy" decoding="async" draggable={false}
                onError={() => setFailedSrc(cover)}
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  mixBlendMode: COVER_BLEND,
                  opacity: COVER_BLEND === 'luminosity' ? 0.88 : 1,
                  filter: COVER_BLEND === 'luminosity'
                    ? 'brightness(0.62) contrast(1.08)'
                    : 'brightness(0.82) saturate(0.92)',
                }} />
              {/* A 10% breath of the card's own hue, so a cover still belongs
                  to the family it sits in. Degrades to a faint haze rather
                  than to nothing if `overlay` is unsupported. */}
              <span aria-hidden className="absolute inset-0"
                style={{ background: skin.tint, opacity: 0.1, mixBlendMode: 'overlay' }} />
            </>
          )}
        </div>

        {/* Constant scrim: the type at the foot sits on the same darkness
            whether the layer above it is a photograph or a gradient. Fixed
            near-black alpha over an always-dark banner, so it is
            theme-independent by construction. */}
        <span aria-hidden className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(4,8,16,0.20) 0%, rgba(4,8,16,0.12) 38%, rgba(4,8,16,0.56) 74%, rgba(4,8,16,0.86) 100%)' }} />

        {/* The hairline every banner in this file carries. Drawn here as well
            as inside the SVG, because the SVG's own hairline is under the
            cover — and this line is what stops the banner's 18% foot reading
            as a hole punched in the #12151F card surface in dark mode. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px"
          style={{ background: skin.tint, opacity: 0.34 }} />

        {node.shared && (
          /* Still the admin dashboard's violet, but as tint on glass rather
             than white on #A78BFA — that pairing measures under 3:1 and was
             the weakest type on the card. Same mark, legible. */
          <span className="absolute left-2.5 top-2.5 inline-flex max-w-[calc(100%-1.25rem)] items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{
              background: 'rgba(8,12,22,0.55)',
              border: `1px solid rgba(${SHARED_RGB},0.45)`,
              color: '#CFC0FF', backdropFilter: 'blur(6px)',
            }}>
            <Share2 size={8} strokeWidth={2.5} className="flex-shrink-0" />
            <span className="truncate">Shared with your academy</span>
          </span>
        )}

        {/* The hero figure, echoing the module card's numeral one level down:
            same face, same size, same corner. There it counts the module's
            place; here it counts how much course there is to book — so the
            banner and the footer never carry the same number twice. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3.5">
          <div className="min-w-0">
            <span className="dm block truncate text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ color: skin.tint }}>
              {node.program ? titleCase(node.program) : 'Course'}
            </span>
            <span className="flex items-baseline gap-1.5">
              {/* Not pure #FFF — the dark palette stops at #E8EAF0 to avoid
                  haloing, and a 30px numeral is exactly that case. */}
              <span className="syne text-[30px] font-extrabold leading-none tracking-tight"
                style={{ color: 'rgba(255,255,255,0.95)' }}>{pad2(moduleCount)}</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.16em]"
                style={{ color: 'rgba(255,255,255,0.72)' }}>
                {moduleCount === 1 ? 'Module' : 'Modules'}
              </span>
            </span>
          </div>

          {level && (
            <span className="inline-flex max-w-[45%] flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide"
              style={{
                background: 'rgba(8,12,22,0.42)', border: '1px solid rgba(255,255,255,0.22)',
                color: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(6px)',
              }}>
              {rungs > 0 && <LevelMeter rungs={rungs} />}
              <span className="truncate">{level}</span>
            </span>
          )}
        </div>
      </div>

      {/* ── the body ── */}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <h3 className="syne line-clamp-2 break-words text-[13px] font-extrabold uppercase leading-[1.35] tracking-[0.02em]"
          style={{ color: 'var(--color-text-primary)' }}>
          {titleCase(node.title)}
        </h3>

        {/* Always three lines' worth of room, described or not: an absent
            description must not leave a shorter, emptier card in the row
            beside a described one. The generic line is muted so it reads as
            chrome rather than as somebody's copy. */}
        <p className="line-clamp-3 break-words text-[11.5px] leading-relaxed"
          style={{ color: node.description?.trim() ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
          {node.description?.trim()
            || 'Live sessions for this course, grouped by module — open one to see the slots you can book.'}
        </p>

        {/* The hairline every sibling card separates its footer with. The
            module count is the banner's numeral, so this carries the figure
            the banner does not. */}
        <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] font-medium"
          style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
          <span className="flex min-w-0 items-center gap-1">
            <Calendar size={10} strokeWidth={2} className="flex-shrink-0" />
            <span className="truncate">
              {empty ? 'No sessions yet' : `${plural(node.sessionCount, 'Session')} ahead`}
            </span>
          </span>
        </div>

        {/* Delta blue and white, the same primary CTA ModuleCard carries one
            level down — stable in both themes, unlike an ink button whose
            inverse text flips with the palette. */}
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

/** Five up on a wide desktop, as the reference is, and one up at 375px.
    `items-stretch` is the grid default and every card is `h-full`, so a row is
    as tall as its tallest card and every CTA in that row shares a baseline. */
function CourseGrid({ courses, onOpen }: {
  courses: CourseCardNode[]; onOpen: (course: CourseCardNode) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {courses.map((c, i) => (
        <CourseCard key={c.id || 'unassigned'} node={c} index={i} onOpen={() => onOpen(c)} />
      ))}
    </div>
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
   · THE COUNTS STOP BEING DECORATION. Sessions, languages, slots and the
     soonest session sit on the header as four tiles. That is what the dead
     space is spent on, and all four were already computed.
   · THE SLOTS ARE A GRID. A slot is a standing weekly commitment, not a diary
     row, so the card leads with the WEEKDAY and the CLOCK — the two things a
     student actually chooses between — and puts the run of dates, the seats,
     the instructor and the room underneath it. The column count follows the
     number of slots, because three columns holding one card is the same dead
     space in a different shape.
   · IT NEVER OVERSTATES A SEAT. On a shared class seatsLeft() is YOUR
     academy's remainder, not the room's, so the fill meter — which needs both
     numbers to be about the same pool — is dropped and the honest count is
     kept. Same reason the blocked module downgrades a bookable slot: the
     modal will refuse it.
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
          <StatTile icon={<Layers size={13} strokeWidth={2} />}
            value={String(node.groups.length)} label={node.groups.length === 1 ? 'Slot' : 'Slots'} />
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

/* ── The slot card ──────────────────────────────────────────────────────── */

/** The run of sessions behind one weekly slot, drawn as a strip: hollow for
    the ones already taught, solid for the ones still ahead, and the next one
    (or the one you hold a seat in) larger and in the status colour. It answers
    "how far into this series am I" in the space a sentence would have taken.

    Past-ness is read from the CLOCK via isPastEnd, not from the index: the
    strip must not depend on buildGroups still sorting its slots ascending, and
    a cancelled session in the middle of a run is not a session you attended.
    The window follows the next session, so session 10 of 12 still shows its
    own dot instead of eight grey ones and a "+4". */
function SessionStrip({ slots, markIds, color }: {
  slots: LiveClass[]; markIds: string[]; color: string
}) {
  const MAX = 8
  const focus = slots.findIndex(s => markIds.includes(s.id))
  const start = Math.min(Math.max(0, (focus < 0 ? slots.length : focus) - 3),
                         Math.max(0, slots.length - MAX))
  const win   = slots.slice(start, start + MAX)
  const after = slots.length - (start + win.length)

  return (
    <span aria-hidden className="flex flex-shrink-0 items-center gap-[3px]">
      {start > 0 && (
        <span className="mr-0.5 text-[9px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
          +{start}
        </span>
      )}
      {win.map(s => {
        const mark = markIds.includes(s.id)
        const done = isPastEnd(s) || s.status === 'cancelled'
        return (
          <span key={s.id} className={`rounded-full ${mark ? 'h-2 w-2' : 'h-1.5 w-1.5'}`}
            style={mark
              ? { background: color }
              : done
                ? { background: 'var(--color-border)' }
                : { background: 'var(--color-text-muted)', opacity: 0.45 }} />
        )
      })}
      {after > 0 && (
        <span className="ml-0.5 text-[9px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
          +{after}
        </span>
      )}
    </span>
  )
}

/* What the card's button says, and how loud it is.

   'primary' is the solid Delta blue every other screen uses for the one action
   it wants — white on #0057b8, legible under either theme.
   'soft' takes the status tint as its GROUND and --color-text-primary as its
   ink, with the status colour left to the icon, the rail and the badge. A
   status-coloured label would be the largest piece of type on the card in the
   one colour that is not guaranteed to survive both themes (white on
   --color-danger is 2.4:1 once dark lifts it to #F87171).
   'muted' is the inset chip the module grid uses for a card you cannot act on. */
type CtaTone = 'primary' | 'soft' | 'muted'
function slotCta(status: SlotStatus, blocked: boolean, dates: number):
  { label: string; tone: CtaTone; icon: React.ReactNode } {
  if (blocked) return { label: 'View sessions', tone: 'muted', icon: <Lock size={12} strokeWidth={2.5} /> }
  switch (status) {
    case 'live':     return { label: 'Join now',      tone: 'soft',    icon: <Radio size={12} strokeWidth={2.5} /> }
    case 'booked':   return { label: 'Your seat',     tone: 'soft',    icon: <Check size={12} strokeWidth={2.5} /> }
    case 'bookable': return { label: dates > 1 ? 'Choose a date' : 'Book a seat',
                                                      tone: 'primary', icon: <BookOpen size={12} strokeWidth={2.5} /> }
    case 'full':     return { label: dates > 1 ? 'See other dates' : 'Slot is full',
                                                      tone: 'muted',   icon: <Users size={12} strokeWidth={2.5} /> }
    case 'closed':   return { label: dates > 1 ? 'See other dates' : 'Booking closed',
                                                      tone: 'muted',   icon: <Clock size={12} strokeWidth={2.5} /> }
    case 'locked':   return { label: 'View details',  tone: 'muted',   icon: <Lock size={12} strokeWidth={2.5} /> }
    default:         return { label: 'View details',  tone: 'muted',   icon: <Calendar size={12} strokeWidth={2.5} /> }
  }
}

function SlotCard({ group, bookingMap, blocked, index, onOpen }: {
  group: ClassGroup; bookingMap: Map<string, MyBooking>; blocked: boolean
  index: number; onOpen: () => void
}) {
  const still    = nextSlot(group.slots)
  const next     = still ?? group.slots[0]!
  const pattern  = slotPattern(group.slots)
  const booking  = bookingMap.get(next.id)
  const hasOther = !!group.bookedSlot && group.bookedSlot.id !== next.id
  const status: SlotStatus = getSlotStatus(next, booking, hasOther)
  const reduce   = useReducedMotion()

  /* A blocked module's sessions are listed but cannot be booked, so the badge
     must not say "Open · 6 left" over a slot the modal will refuse. Only the
     two states that promise a seat are downgraded; a booking you already hold,
     a live class and every past state still say exactly what they are. */
  const shown: SlotStatus = blocked && (status === 'bookable' || status === 'full') ? 'locked' : status
  const c = SC[shown]

  const cap   = next.sessionCapacity
  const left  = Math.max(0, seatsLeft(next))
  /* CROSS-ACADEMY: on a shared class seatsLeft() is the caller's own
     allocation, not the room's remainder, so `cap - left` is not "seats
     taken" — a guest with a floor of 5 and 4 left would have read 87% full on
     a half-empty class. The count is still true; only the ratio is dropped. */
  const yours = next.seatsLeftForYou != null
  const seats = !blocked && cap > 0 && (shown === 'bookable' || shown === 'full' || shown === 'booked')
  const taken = Math.min(100, Math.max(0, Math.round(((cap - left) / cap) * 100)))
  const scarce = left > 0 && left <= 3

  const offline = next.isOnline === false
  const where   = [next.location, next.room].filter(Boolean).join(' · ')

  const cta   = slotCta(shown, blocked, group.slots.length)
  const marks = [still?.id, group.bookedSlot?.id].filter(Boolean) as string[]

  const when = pattern
    ? `${pattern.weekday}s at ${pattern.time}`
    : `next ${fmtDate(next.scheduledStart)} at ${fmtTime(next.scheduledStart)}`

  return (
    /* ONE focusable element, as every other card on these three levels is. The
       button below is a span that looks like one — a real nested button would
       make the card unreachable by keyboard and invalid HTML. The focus ring is
       an OUTLINE rather than a Tailwind `ring`, because a ring is a box-shadow
       and cardHover animates boxShadow out from under it. */
    <motion.button type="button" onClick={onOpen}
      {...cardHover}
      initial={{ opacity: 0, y: 12 }}
      /* Inside the animate target, not a top-level prop — see ModuleCard. */
      animate={{ opacity: 1, y: 0, transition: { ...spring, delay: Math.min(index, 8) * 0.04 } }}
      style={{ ...CARD, outlineColor: 'var(--color-primary-on-surface, var(--color-primary))' }}
      aria-label={`${group.title} — ${when}, ${plural(group.slots.length, 'session')}, ${c.label}`}
      className="dm group relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">

      {/* The status rail. Four pixels of the one colour that answers "can I
          have this?", clipped by the card's own radius — the whole grid can be
          read down its left edge before a single word is. Decorative, so it
          carries the brand value rather than the lifted ink. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1"
        style={{ background: c.color, opacity: shown === 'bookable' || shown === 'live' || shown === 'booked' ? 1 : 0.45 }} />

      <div className="flex flex-1 flex-col p-3.5 pl-4 sm:p-4 sm:pl-[18px]">

        {/* ── headline: the weekday and the clock ── */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: 'var(--color-text-muted)' }}>{titleCase(group.title)}</p>

            {/* slotPattern returns null the moment the sessions disagree, and
                the fallback shows the date instead. A weekday that is only true
                for some of the series would send a student to the wrong one. */}
            <p className="syne mt-1 truncate text-[19px] font-extrabold leading-tight sm:text-[21px]"
              style={{ color: 'var(--color-text-primary)' }}>
              {pattern ? `${pattern.weekday}s` : fmtDate(next.scheduledStart)}
            </p>

            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] font-semibold"
              style={{ color: 'var(--color-text-secondary)' }}>
              <Clock size={11} strokeWidth={2.25} className="flex-shrink-0" />
              {pattern ? pattern.time : fmtTime(next.scheduledStart)}
              <span aria-hidden style={{ color: 'var(--color-text-muted)' }}>·</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{next.durationMins || 60} min</span>
            </p>
          </div>

          <span className="flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: c.bg, color: ink(c.color), border: `1px solid ${c.border}` }}>
            {shown === 'live' && (
              <motion.span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }}
                animate={reduce ? undefined : { opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
            )}
            {c.label}
          </span>
        </div>

        {offline && (
          <p className="mt-2 flex items-center gap-1 text-[11px] font-medium"
            style={{ color: 'var(--color-text-muted)' }}>
            <MapPin size={10} strokeWidth={2.25} className="flex-shrink-0" />
            <span className="truncate">{where || 'In person'}</span>
          </p>
        )}

        {/* ── the series ── */}
        <div className="mt-2.5 flex items-center gap-2">
          <SessionStrip slots={group.slots} markIds={marks} color={c.color} />
          <span className="truncate text-[10.5px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            {still
              ? `${plural(group.slots.length, 'session')} · next ${fmtMonthDay(still.scheduledStart)}`
              : plural(group.slots.length, 'session')}
          </span>
        </div>

        {/* ── the seats ── */}
        {seats && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10.5px] font-bold"
                style={{ color: scarce ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>
                {left === 0
                  ? 'No seats left'
                  : yours
                    ? `${left} ${left === 1 ? 'seat' : 'seats'} left for your academy`
                    : `${left} of ${cap} seats left`}
              </span>
              {!yours && (
                <span className="flex flex-shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <Users size={9} strokeWidth={2.5} />{taken}% full
                </span>
              )}
            </div>
            {!yours && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}>
                <motion.span className="block h-full rounded-full"
                  initial={reduce ? false : { width: 0 }} animate={{ width: `${taken}%` }}
                  transition={{ ...spring, delay: 0.1 + Math.min(index, 8) * 0.04 }}
                  style={{ background: left === 0 ? 'var(--color-text-muted)' : scarce ? 'var(--color-warning)' : 'var(--color-primary)' }} />
              </div>
            )}
          </div>
        )}

        {/* ── the instructor ── */}
        <div className="mt-auto flex items-center gap-2 pt-3.5"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          {group.instructor ? (
            <>
              <AvatarImg src={group.instructor.avatarUrl} name={group.instructor.name}
                className="h-6 w-6 flex-shrink-0 rounded-full object-cover"
                fallbackClassName="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                fallbackStyle={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold"
                style={{ color: 'var(--color-text-secondary)' }}>{group.instructor.name}</span>
            </>
          ) : (
            <span className="flex-1 text-[11.5px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
              Instructor to be announced
            </span>
          )}
        </div>

        <span aria-hidden
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold transition-opacity group-hover:opacity-90"
          style={cta.tone === 'primary'
            ? { background: 'var(--color-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(0,87,184,0.25)' }
            : cta.tone === 'soft'
              ? { background: c.bg, color: 'var(--color-text-primary)', border: `1px solid ${c.border}` }
              : { background: 'var(--color-bg-inset)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
          <span className="flex items-center" style={{ color: cta.tone === 'soft' ? ink(c.color) : undefined }}>
            {cta.icon}
          </span>
          {cta.label}
        </span>
      </div>
    </motion.button>
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

export function ModuleSheet({
  course, node, position, bookingMap, search, onNavigate, onOpenGroup,
}: {
  course:      CourseNode
  node:        ModuleNode
  position:    number | null
  bookingMap:  Map<string, MyBooking>
  search:      string
  onNavigate:  (courseId: string | null, moduleId: string | null) => void
  onOpenGroup: (group: ClassGroup) => void
}) {
  const q = search.trim().toLowerCase()

  /* The search box stays on screen at every level, so it has to mean something
     at every level. Here it matches the class title, the instructor and the
     language — the three things that tell one slot of a module from another. */
  const groups = q
    ? node.groups.filter(g =>
        g.title.toLowerCase().includes(q) ||
        (g.instructor?.name ?? '').toLowerCase().includes(q) ||
        (g.slots[0]?.language ?? '').toLowerCase().includes(q))
    : node.groups

  const byLanguage = new Map<string, ClassGroup[]>()
  for (const g of groups) {
    const lang = g.slots[0]?.language || 'Unspecified'
    if (!byLanguage.has(lang)) byLanguage.set(lang, [])
    byLanguage.get(lang)!.push(g)
  }
  const languages = [...byLanguage.keys()].sort()

  /* THE COLUMN COUNT FOLLOWS THE CONTENT. Three columns holding one card is
     the same dead space the full-width strip was, wearing a different shape,
     so a lone slot is capped at a card's width instead of being stretched or
     stranded. Counted over the whole sheet, not per language: two languages
     with one slot each is still a two-column screen. */
  const total = groups.length
  const cols  = total === 1 ? 'grid-cols-1 max-w-[560px]'
              : total === 2 ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'

  return (
    <motion.div {...enter} transition={spring} key={`m:${course.id}:${node.id}`}>
    {/* ONE child, deliberately. framer re-creates this element with its
        children as a plain array, and React demands keys from an array of
        children — a static JSX child list normally escapes that via the `jsxs`
        fast path, but the mark does not survive the round trip. A Fragment
        collapses them to one child and adds no DOM node. */}
    <>
      <BackLink label={titleCase(course.title)} onClick={() => onNavigate(course.id, null)} />
      <Crumbs trail={[
        { label: 'Courses', onClick: () => onNavigate(null, null) },
        { label: titleCase(course.title), onClick: () => onNavigate(course.id, null) },
        { label: titleCase(node.title) },
      ]} />

      <ModuleHero node={node} position={position} course={course} />

      <SectionHead
        icon={<Calendar size={12} strokeWidth={2.25} style={{ color: 'var(--color-primary-on-surface, var(--color-primary))' }} />}
        label="Available sessions"
        note={q && groups.length !== node.groups.length
          ? `${groups.length} of ${node.groups.length} match`
          : undefined}
      />

      {groups.length === 0 ? (
        <Empty icon={<Calendar size={26} style={{ color: 'var(--color-primary)' }} />}
          title={q ? 'No sessions match' : 'Nothing scheduled yet'}
          body={q ? 'Try a different search term, or clear the search to see them all.'
                  : 'This module has no upcoming sessions. Check back soon.'} />
      ) : (
        <div className="space-y-7">
          {languages.map(lang => (
            <section key={lang}>
              {/* Language is a real fork in the road — the same module taught in
                  two languages is two different classes to a student — so it
                  heads its own band of the grid rather than sitting inside a
                  card as a badge. Hidden when there is only one: a heading that
                  never varies is furniture. */}
              {languages.length > 1 && (
                <SectionHead
                  icon={<Globe size={12} strokeWidth={2.25} style={{ color: 'var(--color-success)' }} />}
                  label={lang}
                  note={plural(byLanguage.get(lang)!.length, 'slot')}
                />
              )}
              {/* The fix for the dead space: a slot is a card in a grid, not a
                  strip drawn across 1200px with a seat count marooned at the
                  far right of it. */}
              <div className={`grid gap-3.5 ${cols}`}>
                {byLanguage.get(lang)!.map((g, i) => (
                  <SlotCard key={g.id} group={g} bookingMap={bookingMap} blocked={node.blocked}
                    index={i} onOpen={() => onOpenGroup(g)} />
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
    const position = mod.id === GENERAL
      ? null
      : course.modules.filter(m => m.id !== GENERAL).indexOf(mod) + 1
    /* `search` goes in RAW: ModuleSheet owns its own normalisation so it can
       be dropped anywhere without a caller remembering to trim it. */
    return (
      <ModuleSheet course={course} node={mod} position={position} bookingMap={bookingMap}
        search={search} onNavigate={onNavigate} onOpenGroup={onOpenGroup} />
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

