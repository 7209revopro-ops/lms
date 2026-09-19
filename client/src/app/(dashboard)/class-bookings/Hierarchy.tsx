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

/* ── Level 2 — the modules ──────────────────────────────────────────────── */

function ModuleCard({ node, position, index, onOpen }: {
  node: ModuleNode; position: number | null; index: number; onOpen: () => void
}) {
  return (
    <motion.button type="button" onClick={onOpen}
      {...cardHover}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: index * 0.035 }}
      style={{ ...CARD, opacity: node.blocked ? 0.72 : 1 }}
      aria-label={`${node.title} — ${plural(node.sessionCount,'session')}${node.blocked ? ', locked' : ''}`}
      className="dm flex w-full flex-col gap-2 rounded-2xl bg-[var(--color-bg-surface)] p-4 text-left">

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)' }}>
            {position !== null ? `Module ${position}` : 'Sessions'}
          </p>
          <h3 className="mt-0.5 text-sm font-bold leading-snug"
            style={{ color: 'var(--color-text-primary)' }}>{titleCase(node.title)}</h3>
        </div>
        {node.blocked && (
          <Pill icon={<Lock size={9} strokeWidth={2.5} />} rgb="107,114,128" solid="var(--color-text-muted)">
            Locked
          </Pill>
        )}
      </div>

      {node.description && (
        <p className="line-clamp-2 text-xs leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}>{node.description}</p>
      )}

      <div className="mt-1 flex items-center justify-between gap-2 pt-2.5"
        style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="flex items-center gap-2.5 text-[11px] font-medium"
          style={{ color: 'var(--color-text-muted)' }}>
          <span className="flex items-center gap-1">
            <Globe size={10} strokeWidth={2} />
            {node.languages.length} {node.languages.length === 1 ? 'Language' : 'Languages'}
          </span>
          <span className="flex items-center gap-1">
            <Calendar size={10} strokeWidth={2} />
            {node.sessionCount} {node.sessionCount === 1 ? 'Session' : 'Sessions'}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[11px] font-bold"
          style={{ color: node.blocked ? 'var(--color-text-muted)' : 'var(--color-primary-on-surface, var(--color-primary))' }}>
          {node.blocked ? 'View' : 'Choose a slot'}<ChevronRight size={12} strokeWidth={2.5} />
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
          <div className="space-y-2.5">
            {modules.map((m, i) => (
              <ModuleCard key={m.id || 'general'} node={m} index={i}
                position={m.id === GENERAL ? null : ordered.indexOf(m) + 1}
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

export { buildCatalog }
export type { CourseNode, ModuleNode }

/* Exported so the page can resolve a group the hierarchy opened without
   going through `dateSections`, which the hierarchy does not build. */
export function allGroupsIn(catalog: CourseNode[]): ClassGroup[] {
  return catalog.flatMap(c => c.modules.flatMap(m => m.groups))
}

