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
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Lock, Trophy, Sparkles, Play, X, CheckCircle2, Layers, UserRound, Send, ChevronRight } from 'lucide-react'
import { useJourney, type JourneyLevel } from '@/lib/api/journey'
import { useCreateTicket } from '@/lib/api/support'

const STATE = {
  completed: { label: 'Completed', color: '#0ECC8E', bg: 'rgba(14,204,142,0.10)', ring: 'rgba(14,204,142,0.45)' },
  current:   { label: 'In progress', color: '#0057b8', bg: 'rgba(0,87,184,0.08)', ring: 'rgba(0,87,184,0.45)' },
  next:      { label: 'Up next',  color: '#D97706', bg: 'rgba(245,158,11,0.10)', ring: 'rgba(245,158,11,0.55)' },
  locked:    { label: 'Locked',   color: 'var(--color-text-muted)', bg: 'var(--color-bg-inset)', ring: 'var(--color-border)' },
} as const

const short = (t: string) => {
  const m = t.match(/^([A-Z]{2,6})\b/)                       // "MBT", "DSLP", "HADC"
  if (m && t.length > 14) return m[1]!
  const words = t.replace(/[()]/g, '').split(/\s+/).filter(w => w.length > 2)
  return t.length <= 14 ? t : words.map(w => w[0]).join('').slice(0, 5).toUpperCase()
}

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
      className="relative flex w-[112px] flex-shrink-0 flex-col items-center gap-1.5 rounded-2xl px-2 pb-3 pt-3 text-center outline-none"
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
      <span className="syne line-clamp-1 text-[12px] font-700" style={{ color: lv.state === 'locked' ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>{short(lv.title)}</span>
      <span className="text-[10px] font-semibold" style={{ color: st.color }}>
        {lv.state === 'current' ? `${lv.progressPercent}% · ${lv.modulesOpen}/${lv.modulesTotal} modules` : st.label}
      </span>
    </motion.button>
  )
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="dm relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[var(--color-bg-surface)] p-6 sm:rounded-3xl"
        style={{ boxShadow: '0 24px 64px rgba(15,23,42,0.22)' }} role="dialog">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full p-1.5 hover:bg-[var(--color-bg-muted)]" aria-label="Close">
          <X size={16} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        {children}
      </motion.div>
    </div>
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

function AdvisorLine({ advisor }: { advisor: { name?: string; team?: string } | null }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5" style={{ background: 'var(--color-bg-inset)' }}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}><UserRound size={15} /></span>
      <span className="min-w-0 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {advisor?.name ? <>Your advisor: <b style={{ color: 'var(--color-text-primary)' }}>{advisor.name}</b>{advisor.team ? ` · ${advisor.team}` : ''}</> : 'Our support team will help you.'}
      </span>
    </div>
  )
}

export function JourneyBar({ onPickCourse }: { onPickCourse?: (courseId: string) => void }) {
  const { data } = useJourney()
  const [open, setOpen] = useState<JourneyLevel | null>(null)
  const [mod, setMod] = useState<{ courseId?: string; courseTitle?: string; moduleTitle?: string } | null>(null)

  useEffect(() => {
    const h = (e: Event) => setMod((e as CustomEvent).detail ?? {})
    window.addEventListener('lms:module-locked', h)
    return () => window.removeEventListener('lms:module-locked', h)
  }, [])

  const levels = useMemo(() => data?.programmes ?? [], [data])
  const modLevel = mod ? levels.flatMap(p => p.levels).find(l => l.courseId === mod.courseId || l.title === mod.courseTitle) : undefined
  if (!levels.length && !mod) return null

  return (
    <>
      {levels.map(p => {
        const done = p.levels.filter(l => l.state === 'completed').length
        const at = Math.max(1, ...p.levels.filter(l => l.state !== 'locked' && l.state !== 'next').map(l => l.level))
        return (
          <section key={p.program} className="mb-5 rounded-3xl p-4 sm:p-5"
            style={{ background: 'linear-gradient(135deg, var(--color-bg-surface), var(--color-primary-light))', border: '1px solid var(--color-border)', boxShadow: '0 2px 10px rgba(15,23,42,0.05)' }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>Your {p.label} journey</p>
                <p className="syne text-[15px] font-700" style={{ color: 'var(--color-text-primary)' }}>
                  Level {at} of {p.levels.length}{done ? ` · ${done} completed 🏆` : ''}
                </p>
              </div>
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                {Math.round((done / p.levels.length) * 100)}% of the path
              </span>
            </div>
            <div className="-mx-1 flex items-center gap-0 overflow-x-auto px-1 pb-1">
              {p.levels.map((lv, i) => (
                <div key={lv.courseId} className="flex items-center">
                  <Level lv={lv} index={i} onOpen={() => (lv.state === 'current' || lv.state === 'completed') && onPickCourse ? onPickCourse(lv.courseId) : setOpen(lv)} />
                  {i < p.levels.length - 1 && (
                    <span className="mx-1 h-[3px] w-5 flex-shrink-0 rounded-full sm:w-8"
                      style={{ background: lv.state === 'completed' ? '#0ECC8E' : 'repeating-linear-gradient(90deg, var(--color-border) 0 6px, transparent 6px 10px)' }} />
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      })}

      <AnimatePresence>
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
