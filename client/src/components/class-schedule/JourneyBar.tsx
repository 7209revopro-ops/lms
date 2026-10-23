'use client'

/* ─────────────────────────────────────────────────────────────
   Your journey — the level bar at the top of the Class Schedule.

   Each course of the student's programme is a level, in order:
     🏆 completed · ▶ current (progress ring, open modules) · ✨ up next · 🔒 locked.
   A locked or up-next level opens the unlock sheet (what it is, open the
   course page to buy it, or ask their advisor). A locked module anywhere on
   the page — the course view's "How to unlock", or a refused booking — opens
   the module sheet through the 'lms:module-locked' event (showModuleLocked).
   "Ask for access" files a support request the student does not have to
   write: their advisor / the support team picks it up.
───────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Lock, Trophy, Sparkles, Play, CheckCircle2, Layers, UserRound, Send, ChevronRight } from 'lucide-react'
import { useJourney, type JourneyLevel } from '@/lib/api/journey'
import { useCreateTicket } from '@/lib/api/support'

const STATE = {
  completed: { label: 'Completed', color: '#0ECC8E', bg: 'rgba(14,204,142,0.10)', ring: 'rgba(14,204,142,0.45)' },
  current:   { label: 'In progress', color: '#0057b8', bg: 'rgba(0,87,184,0.08)', ring: 'rgba(0,87,184,0.45)' },
  next:      { label: 'Up next',  color: '#D97706', bg: 'rgba(245,158,11,0.10)', ring: 'rgba(245,158,11,0.55)' },
  locked:    { label: 'Locked',   color: 'var(--color-text-muted)', bg: 'var(--color-bg-inset)', ring: 'var(--color-border)' },
} as const

/* "MARKET BREAK-OUT TRADING PROGRAM" → "Market Break-Out Trading Program";
   a leading code ("DSLP - Delta Structure …", "MMC (MARKET MAKING CYCLE)")
   stays in capitals. */
const KEEP_CAPS = new Set(['AI', 'UAE', 'HR', 'MBT', 'DWT', 'MMC', 'HADC', 'DSLP', 'SEO', 'JURA'])
const courseName = (t: string) => t.trim().split(/\s+/).map(w => {
  const bare = w.replace(/[^A-Za-z]/g, '')
  if (KEEP_CAPS.has(bare.toUpperCase()) && bare === bare.toUpperCase()) return w
  return w.toLowerCase().replace(/(^|[(\-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
}).join(' ')

/* A progress ring around the level's badge. */
function Ring({ pct, color, size = 58, children }: { pct: number; color: string; size?: number; children: React.ReactNode }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={4} />
        {pct > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(pct, 100) / 100)} />}
      </svg>
      {children}
    </div>
  )
}

function Level({ lv, onOpen, index }: { lv: JourneyLevel; onOpen: () => void; index: number }) {
  const reduce = useReducedMotion()
  const st = STATE[lv.state]
  const icon = lv.state === 'completed' ? <Trophy size={20} strokeWidth={2.2} />
    : lv.state === 'current' ? <Play size={18} strokeWidth={2.4} />
    : lv.state === 'next' ? <Sparkles size={19} strokeWidth={2.2} /> : <Lock size={17} strokeWidth={2.2} />
  return (
    <motion.button type="button" onClick={onOpen}
      initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06, type: 'spring', stiffness: 300, damping: 24 }}
      whileHover={reduce ? undefined : { y: -3 }} whileTap={reduce ? undefined : { scale: 0.97 }}
      className="relative flex w-full flex-col items-center gap-1.5 rounded-2xl px-2 pb-3 pt-3 text-center outline-none"
      style={{ background: st.bg, border: `1.5px solid ${st.ring}` }}
      aria-label={`Level ${lv.level}: ${lv.title} — ${st.label}`}>
      {lv.state === 'next' && !reduce && (
        <motion.span className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `0 0 0 0 ${st.ring}` }}
          animate={{ boxShadow: [`0 0 0 0 rgba(245,158,11,0.45)`, `0 0 0 8px rgba(245,158,11,0)`] }} transition={{ duration: 1.8, repeat: Infinity }} />
      )}
      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: st.color }}>Level {lv.level}</span>
      <Ring pct={lv.state === 'completed' ? 100 : lv.progressPercent} color={st.color as string}>
        <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--color-bg-surface)', color: st.color }}>{icon}</span>
      </Ring>
      <span className="syne line-clamp-2 min-h-[30px] text-[11.5px] font-700 leading-tight" title={lv.title} style={{ color: lv.state === 'locked' ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>{courseName(lv.title)}</span>
      <span className="text-[10px] font-semibold" style={{ color: st.color }}>
        {lv.state === 'current' ? `${lv.progressPercent}% · ${lv.modulesOpen}/${lv.modulesTotal} modules` : st.label}
      </span>
    </motion.button>
  )
}

/* The shared drawer / popup (swipe down to close on phones), padded and
   scrolling as one block. */
function Sheet({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <BottomSheet label="Your journey" onClose={onClose} wide={wide}>
      <div className="dm min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-3 sm:pt-6">{children}</div>
    </BottomSheet>
  )
}

/* "Ask for access" — files the support request for them. */
function AskForAccess({ subject, message }: { subject: string; message: string }) {
  const create = useCreateTicket()
  const [sent, setSent] = useState(false)
  if (sent) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold" style={{ background: 'rgba(14,204,142,0.10)', color: '#047857' }}>
        <CheckCircle2 size={15} />Request sent — your advisor will get back to you
      </div>
    )
  }
  return (
    <button type="button" disabled={create.isPending}
      onClick={async () => { try { await create.mutateAsync({ subject, category: 'course', message }); setSent(true) } catch { /* the button stays */ } }}
      className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold disabled:opacity-60"
      style={{ background: 'var(--color-bg-inset)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' }}>
      <Send size={14} />{create.isPending ? 'Sending…' : 'Ask my advisor to unlock it'}
    </button>
  )
}

function AdvisorLine({ advisor }: { advisor: { name?: string } | null }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5" style={{ background: 'var(--color-bg-inset)' }}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}><UserRound size={15} /></span>
      <span className="min-w-0 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {advisor?.name ? <>Your advisor: <b style={{ color: 'var(--color-text-primary)' }}>{advisor.name}</b></> : 'Our support team will help you.'}
      </span>
    </div>
  )
}

/* The level they are on: the furthest course they hold (1 if none). */
const levelAt = (ls: JourneyLevel[]) => Math.max(1, ...ls.filter(l => l.state === 'current' || l.state === 'completed').map(l => l.level))

export function JourneyBar({ onPickCourse }: { onPickCourse?: (courseId: string) => void }) {
  const { data } = useJourney()
  const [open, setOpen] = useState<JourneyLevel | null>(null)
  const [showJourney, setShowJourney] = useState(false)
  const [mod, setMod] = useState<{ courseId?: string; courseTitle?: string; moduleTitle?: string } | null>(null)

  useEffect(() => {
    const h = (e: Event) => setMod((e as CustomEvent).detail ?? {})
    window.addEventListener('lms:module-locked', h)
    return () => window.removeEventListener('lms:module-locked', h)
  }, [])

  const levels = useMemo(() => data?.programmes ?? [], [data])

  /* Opens by itself after a minute on the page — once a day, per browser. */
  useEffect(() => {
    if (!levels.length) return
    const today = new Date().toISOString().slice(0, 10)
    let seen: string | null = null
    try { seen = localStorage.getItem('lms_journey_auto_day') } catch { /* private mode */ }
    if (seen === today) return
    const t = setTimeout(() => {
      setShowJourney(true)
      try { localStorage.setItem('lms_journey_auto_day', today) } catch { /* ignore */ }
    }, 60_000)
    return () => clearTimeout(t)
  }, [levels.length])
  const modLevel = mod ? levels.flatMap(p => p.levels).find(l => l.courseId === mod.courseId || l.title === mod.courseTitle) : undefined
  if (!levels.length && !mod) return null

  return (
    <>
      {/* On the page: one compact bar. The journey itself opens over it —
          a centred popup on a laptop, a bottom drawer on a phone (Sheet). */}
      {levels.length > 0 && (
        <motion.button type="button" onClick={() => setShowJourney(true)}
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -1 }} whileTap={{ scale: 0.99 }}
          className="mb-5 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none"
          style={{ background: 'linear-gradient(135deg, var(--color-bg-surface), var(--color-primary-light))', border: '1px solid var(--color-border)', boxShadow: '0 2px 10px rgba(15,23,42,0.05)' }}
          aria-label="Open your journey">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--color-primary)', color: '#fff' }}><Trophy size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>Your journey</span>
            <span className="syne block truncate text-[14px] font-700" style={{ color: 'var(--color-text-primary)' }}>
              {levels.map(p => `${p.label} · Level ${levelAt(p.levels)} of ${p.levels.length}`).join('   |   ')}
            </span>
            <span className="mt-1 flex gap-1" aria-hidden>
              {levels[0]!.levels.map(l => (
                <span key={l.courseId} className="h-1.5 flex-1 max-w-8 rounded-full"
                  style={{ background: l.state === 'completed' ? '#0ECC8E' : l.state === 'current' ? '#0057b8' : l.state === 'next' ? '#F59E0B' : 'var(--color-border)' }} />
              ))}
            </span>
          </span>
          {levels.some(p => p.levels.some(l => l.state === 'next')) && (
            <span className="hidden flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold sm:inline" style={{ background: 'rgba(245,158,11,0.14)', color: '#B45309' }}>✨ Up next</span>
          )}
          <ChevronRight size={18} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
        </motion.button>
      )}

      <AnimatePresence>
        {showJourney && (
          <Sheet wide onClose={() => setShowJourney(false)}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>Your journey</p>
            <h3 className="syne mt-1 pr-8 text-lg font-800" style={{ color: 'var(--color-text-primary)' }}>Level up, course by course</h3>
            <div className="mt-4 space-y-5">
              {levels.map(p => {
                const done = p.levels.filter(l => l.state === 'completed').length
                return (
                  <section key={p.program}>
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <p className="syne text-[14px] font-700" style={{ color: 'var(--color-text-primary)' }}>
                        {p.label} · Level {levelAt(p.levels)} of {p.levels.length}{done ? ` · ${done} completed 🏆` : ''}
                      </p>
                      <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'var(--color-bg-inset)', color: 'var(--color-text-secondary)' }}>
                        {Math.round((done / p.levels.length) * 100)}% done
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {p.levels.map((lv, i) => (
                        <Level key={lv.courseId} lv={lv} index={i} onOpen={() => {
                          if ((lv.state === 'current' || lv.state === 'completed') && onPickCourse) { setShowJourney(false); onPickCourse(lv.courseId) }
                          else { setShowJourney(false); setOpen(lv) }
                        }} />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
            <p className="mt-4 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Tap a course you have to see its classes; tap a locked one to unlock it.</p>
          </Sheet>
        )}
        {open && (
          <Sheet onClose={() => setOpen(null)}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: STATE[open.state].color }}>Level {open.level} · {STATE[open.state].label}</p>
            <h3 className="syne mt-1 pr-8 text-lg font-800 leading-snug" style={{ color: 'var(--color-text-primary)' }}>{open.title}</h3>
            {open.state === 'next' && <p className="mt-1 text-sm font-semibold" style={{ color: '#B45309' }}>You finished the level before — this is your next step ✨</p>}
            {open.description && <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{open.description}</p>}
            <div className="mt-4 space-y-2.5">
              {open.slug && (
                <Link href={`/courses/${open.slug}`} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white" style={{ background: 'var(--color-primary)' }}>
                  <Sparkles size={14} />Unlock this course<ChevronRight size={14} />
                </Link>
              )}
              <AdvisorLine advisor={data?.advisor ?? null} />
              <AskForAccess subject={`Unlock request: ${open.title}`}
                message={`I'd like to join ${open.title} (level ${open.level} of my journey). Please help me unlock it.`} />
            </div>
          </Sheet>
        )}
        {mod && (
          <Sheet onClose={() => setMod(null)}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(245,158,11,0.12)', color: '#B45309' }}><Lock size={22} /></span>
            <h3 className="syne mt-3 pr-8 text-lg font-800 leading-snug" style={{ color: 'var(--color-text-primary)' }}>
              {mod.moduleTitle ? `${mod.moduleTitle} is locked` : 'This module is locked'}
            </h3>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {modLevel?.lockReason === 'payment'
                ? 'It opens once the rest of your course fee is paid. Your advisor can help you with the payment.'
                : 'Your academy opens modules step by step. Ask your advisor to open it for you.'}
            </p>
            {modLevel && modLevel.modulesTotal > 0 && (
              <div className="mt-4 rounded-2xl p-3.5" style={{ background: 'var(--color-bg-inset)' }}>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>
                  <Layers size={12} />{modLevel.title} · {modLevel.modulesOpen} of {modLevel.modulesTotal} modules open
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {modLevel.modules.map(m => (
                    <span key={m.id} title={m.title} className="flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-lg px-1.5 text-[11px] font-bold"
                      style={m.locked ? { background: 'var(--color-bg-surface)', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)' }
                        : { background: 'rgba(14,204,142,0.14)', color: '#047857' }}>
                      {m.locked ? <Lock size={9} /> : null}{m.number}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 space-y-2.5">
              <AdvisorLine advisor={data?.advisor ?? null} />
              <AskForAccess subject={`Unlock request: ${mod.moduleTitle ?? 'a module'}${mod.courseTitle ? ` (${mod.courseTitle})` : ''}`}
                message={`Please unlock ${mod.moduleTitle ?? 'this module'}${mod.courseTitle ? ` in ${mod.courseTitle}` : ''} so I can book its classes.`} />
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </>
  )
}
