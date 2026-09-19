'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Calendar, Clock,
  Radio, CheckCircle2, Video, BookOpen, Globe,
  AlertCircle, User, Users, X, CalendarDays, Search,
  Building2, Lock, MapPin, Wifi, Flame, TrendingUp,
  GraduationCap, UserCircle2, SlidersHorizontal, Zap, ChevronDown, LayoutGrid, List,
} from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/store/ui.store'
import { useAllLiveClasses, type LiveClass } from '@/lib/api/liveClasses'
import { useMyBookings, useCreateBooking, useCancelBooking, type MyBooking } from '@/lib/api/bookings'
import { useCurrentUser } from '@/lib/api/user'
import { APP_TIMEZONE } from '@/lib/timezone'
import { useJoinClock } from '@/hooks/useJoinClock'
import JoinMeetButton from '@/components/live-classes/JoinMeetButton'
import Spinner from '@/components/ui/Spinner'
import { titleCase } from '@/lib/titleCase'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { useAnchoredPosition } from '@/lib/useAnchoredPosition'
/* THE SCHEDULE'S SHARED RULES — which door this class reached you through,
   how many seats are left FOR YOU, and what you may do with a slot right now.
   Lifted out of this file when the Course -> Module -> Class hierarchy was
   added so the two views cannot answer the same question differently. */
import {
  zonedKey, toZonedDateStr, offlineDayOffset,
  isWithinLiveWindow, isBookingClosed, bookingClosedAt, isPastEnd,
  seatsLeft, isFull, effCourseId, effProgram, effSectionId, effSectionTitle,
  getSlotStatus, SC, buildGroups, groupKeyOf, buildCatalog,
  type SlotStatus, type ClassGroup,
} from '@/lib/classSchedule'
import { Hierarchy, allGroupsIn } from './Hierarchy'

/* ── Google Fonts ──────────────────────────────────────────── */
const FONT_CSS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap');.syne{font-family:'Syne',sans-serif}.dm{font-family:'DM Sans',sans-serif}`
// eslint-disable-next-line react/no-danger
const FontLoader = () => <style dangerouslySetInnerHTML={{ __html: FONT_CSS }} />

/* ── Date helpers ──────────────────────────────────────────── */

/* Day label for a session card.

   Carries the MONTH now. "Wed 19" alone is ambiguous the moment you page to
   another month, and these cards also show up in lists that span months —
   two sessions could both read "Wed 19" and be five weeks apart. The year is
   added only when it differs from the current one, so the common case stays
   short and a January class viewed in December still says which January.

   Today/Tomorrow are decided in the student's own zone — the same zone the
   clock times render in, so "Today, 5:30 PM" always means the reader's today
   and the reader's 5:30. */
function zonedDayLabel(iso: string): string {
  const when = new Date(iso)
  const key  = zonedKey(when)
  const now  = new Date()

  if (key === zonedKey(now)) return 'Today'
  /* A flat 24h step. In a DST zone the transition night is 23/25h long, so
     within ~1h of midnight twice a year this could mislabel — cosmetic only. */
  if (key === zonedKey(new Date(now.getTime() + 86_400_000))) return 'Tomorrow'

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).formatToParts(when)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const sameYear = get('year') === zonedKey(now).slice(0, 4)

  return `${get('weekday')} ${get('day')} ${get('month')}${sameYear ? '' : ` ${get('year')}`}`
}
function getMondayOfWeek(d: Date): Date {
  const r = new Date(d); const day = r.getDay()
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1)); r.setHours(0,0,0,0); return r
}
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtShortSlot(iso: string) { return `${zonedDayLabel(iso)}, ${fmtTime(iso)}` }
function fmtSlotLabel(iso: string, dur: number) {
  const end = new Date(new Date(iso).getTime() + dur * 60_000)
  return `${zonedDayLabel(iso)}, ${fmtTime(iso)} to ${fmtTime(end.toISOString())}`
}
function fmtDateRange(s: Date, e: Date): string {
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear())
    return `${s.toLocaleDateString('en-US',{month:'long'})} ${s.getDate()} to ${e.getDate()}, ${e.getFullYear()}`
  return `${s.toLocaleDateString('en-US',{month:'short',day:'numeric'})} to ${e.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`
}


/* ── Types ─────────────────────────────────────────────────── */
type AccessFilter   = 'all'|'mine'
type DeliveryFilter = 'all'|'online'|'offline'
type ProgramFilter  = 'all'|'4x-trading'|'digital-marketing'|'ai'|'jura'
type StatusFilter   = 'all'|'live'|'upcoming'|'ended'

interface DateSection { dateKey:string; dateLabel:string; isToday:boolean; groups:ClassGroup[] }
interface GroupKey { id:string; dateKey:string }

const PROGRAM_LABELS: Record<string,string> = {
  all:'All', '4x-trading':'FOREX', 'digital-marketing':'Digital Marketing', ai:'AI', jura:'JURA',
}

/* ── Panel chip ────────────────────────────────────────────── */
function PanelChip({ active, onClick, count, children }: {
  active:boolean; onClick:()=>void; count?:number; children:React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick}
      className="dm inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all duration-150 select-none"
      style={active ? {
        background:'rgba(0,87,184,0.10)', color: '#EA6010',
        border:'1.5px solid rgba(0,87,184,0.32)',
        fontWeight:600,
      } : {
        background: 'var(--color-bg-inset)', color: '#475569', border: '1px solid var(--color-border)',
      }}>
      {children}
      {count !== undefined && (
        <span className="rounded-full px-1.5 min-w-[18px] text-center text-[11px] sm:text-[10px] font-semibold"
          style={{
            background:active?'rgba(0,87,184,0.15)':'var(--color-bg-subtle)',
            color:active?'#EA6010':'var(--color-text-muted)',
          }}>
          {count}
        </span>
      )}
    </button>
  )
}

/* ── Panel section ─────────────────────────────────────────── */
function PanelSection({ label, icon, children }: {
  label:string; icon:React.ReactNode; children:React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span style={{color: 'var(--color-text-muted)'}}>{icon}</span>
        <span className="dm text-[11px] sm:text-[10px] font-bold uppercase tracking-widest" style={{color: 'var(--color-text-muted)'}}>{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/* ── Mini calendar ─────────────────────────────────────────── */
function MiniCalendar({rangeStart,rangeEnd,onRangeChange,onClose}: {
  rangeStart:Date; rangeEnd:Date; onRangeChange:(s:Date,e:Date)=>void; onClose:()=>void
}) {
  const [month,setMonth] = useState(()=>new Date(rangeStart.getFullYear(),rangeStart.getMonth(),1))
  const [anchor,setAnchor] = useState<Date|null>(null)
  const [hover,setHover]   = useState<Date|null>(null)
  const today = new Date()
  const firstDay = new Date(month.getFullYear(),month.getMonth(),1).getDay()
  const daysInMonth = new Date(month.getFullYear(),month.getMonth()+1,0).getDate()
  const cells:(Date|null)[] = []
  for(let i=0;i<firstDay;i++) cells.push(null)
  for(let d=1;d<=daysInMonth;d++) cells.push(new Date(month.getFullYear(),month.getMonth(),d))

  const handleDay=(day:Date)=>{
    if(!anchor){setAnchor(day);return}
    const [s,e]=day<anchor?[day,anchor]:[anchor,day]
    onRangeChange(s,e);setAnchor(null);setHover(null);onClose()
  }
  const endRef = anchor?(hover??anchor):null
  const inRange=(d:Date)=>{
    if(anchor&&endRef){const[s,e]=endRef<anchor?[endRef,anchor]:[anchor,endRef];return d>s&&d<e}
    return d>rangeStart&&d<rangeEnd
  }
  const isEP=(d:Date)=>anchor
    ?isSameDay(d,anchor)||(endRef?isSameDay(d,endRef):false)
    :isSameDay(d,rangeStart)||isSameDay(d,rangeEnd)

  const presets=[
    {l:'This week',   f:()=>{const m=getMondayOfWeek(new Date());onRangeChange(m,addDays(m,6));onClose()}},
    {l:'Next 7 days', f:()=>{const t=new Date();t.setHours(0,0,0,0);onRangeChange(t,addDays(t,6));onClose()}},
    {l:'This month',  f:()=>{const t=new Date();onRangeChange(new Date(t.getFullYear(),t.getMonth(),1),new Date(t.getFullYear(),t.getMonth()+1,0));onClose()}},
  ]
  return(
    <motion.div initial={{opacity:0,y:-6,scale:0.97}} animate={{opacity:1,y:0,scale:1}}
      exit={{opacity:0,y:-4,scale:0.97}} transition={{type:'spring',stiffness:420,damping:32}}
      /* Anchored left on a phone: the nav wraps onto its own line at the page
         gutter, so right-0 pushed a 270px popover off the left edge and took
         the Sunday column with it. 270 fits the 343px content box. */
      className="absolute left-0 top-full z-30 mt-2 w-[270px] rounded-2xl p-4 sm:left-auto sm:right-0"
      style={{background: 'var(--color-bg-surface)',border: '1px solid var(--color-border)',boxShadow:'0 20px 48px rgba(0,0,0,0.13)'}}>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[var(--color-bg-muted)]">
          <ChevronLeft size={13} style={{color: 'var(--color-text-muted)'}}/>
        </button>
        <span className="syne text-[13px] font-700" style={{color: 'var(--color-text-primary)'}}>
          {month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}
        </span>
        <button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[var(--color-bg-muted)]">
          <ChevronRight size={13} style={{color: 'var(--color-text-muted)'}}/>
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7">
        {['S','M','T','W','T','F','S'].map((d,i)=>(
          <div key={i} className="py-1 text-center text-[9px] font-bold tracking-wider" style={{color: 'var(--color-text-muted)'}}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day,i)=>{
          if(!day) return <div key={`e${i}`} className="h-7"/>
          const ep=isEP(day);const rng=inRange(day);const tod=isSameDay(day,today)
          return(
            <button key={day.toISOString()} onClick={()=>handleDay(day)}
              onMouseEnter={()=>anchor&&setHover(day)} onMouseLeave={()=>anchor&&setHover(null)}
              className="flex h-7 w-full items-center justify-center rounded-lg text-[11px] transition-all"
              style={{background:ep?'#0057b8':rng?'rgba(0,87,184,0.10)':'transparent',
                color:ep?'white':tod?'#0057b8':'var(--color-text-secondary)',fontWeight:tod&&!ep?700:400}}>
              {day.getDate()}
            </button>
          )
        })}
      </div>
      <p className="my-2 text-center text-[9px]" style={{color: 'var(--color-text-muted)'}}>
        {anchor?'Now pick the end date':'Click to set start date'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p=>(
          <button key={p.l} onClick={p.f}
            className="rounded-full px-2.5 py-1 text-[11px] sm:text-[10px] font-semibold"
            style={{background:'rgba(0,87,184,0.07)',color: 'var(--color-primary)',border:'1px solid rgba(0,87,184,0.16)'}}>
            {p.l}
          </button>
        ))}
      </div>
    </motion.div>
  )
}

/* ── Slot chip ─────────────────────────────────────────────── */

function SlotChip({lc,status,isSelected,onClick}: {
  lc:LiveClass; status:SlotStatus; isSelected:boolean; onClick:()=>void
}) {
  const clickable = ['bookable','booked','attended','ended','live'].includes(status)
  const c = SC[status]
  /* The bar still shows how full the ROOM is — that is what it measures —
     but the badge beside it now reports the caller's own remainder. */
  const capPct = lc.sessionCapacity>0 ? Math.min(100,(lc.bookedCount/lc.sessionCapacity)*100) : 0
  return(
    <motion.button type="button" onClick={clickable?onClick:undefined}
      whileHover={clickable?{scale:1.02}:undefined} whileTap={clickable?{scale:0.97}:undefined}
      className="relative flex flex-col rounded-xl p-2.5 text-left"
      style={{
        background:isSelected?c.bg:'var(--color-bg-inset)', border:`1.5px solid ${isSelected?c.border: 'var(--color-border)'}`,
        boxShadow:isSelected?`0 0 0 3px ${c.bg}`:'none',
        cursor:clickable?'pointer':'default',
        opacity:['full','cancelled','ended','locked','missed'].includes(status)?0.55:1,
      }}>
      <span className="mb-1 text-[9px] font-bold uppercase tracking-wider" style={{color: 'var(--color-text-muted)'}}>
        {zonedDayLabel(lc.scheduledStart)}
      </span>
      <span className="syne mb-2 text-[14px] font-700" style={{color: 'var(--color-text-primary)'}}>{fmtTime(lc.scheduledStart)}</span>
      <span className="self-start rounded-full px-1.5 py-0.5 text-[9px] font-bold"
        style={{background:c.bg,color:c.color,border:`1px solid ${c.border}`}}>
        {status==='bookable'&&lc.sessionCapacity>0 ? `${Math.max(0, seatsLeft(lc))} left` : c.label}
      </span>
      {lc.sessionCapacity>0&&['bookable','booked','live'].includes(status)&&(
        <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full" style={{background: 'var(--color-border)'}}>
          <motion.div initial={{width:0}} animate={{width:`${capPct}%`}} transition={{duration:0.6}}
            style={{height:'100%',borderRadius:99,background:capPct>=90?'#EF4444':capPct>=70?'#D97706':'#059669'}}/>
        </div>
      )}
      {status==='live'&&(
        <motion.span animate={{opacity:[1,0.1,1]}} transition={{duration:1,repeat:Infinity}}
          className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full" style={{background: 'var(--color-danger)'}}/>
      )}
    </motion.button>
  )
}

/* ── Class card ────────────────────────────────────────────── */
function ClassCard({group,bookingMap,onClick}: {
  group:ClassGroup; bookingMap:Map<string,MyBooking>; onClick:()=>void
}) {
  const {slots,bookedSlot,instructor,courseTitle,moduleTitle} = group
  const first = slots[0]
  const isOffline  = (first as any)?.isOnline===false
  const isEnrolled = (first as any)?.isEnrolled!==false
  const hasLive    = slots.some(s=>s.status==='live')
  const bookable   = slots.filter(s=>getSlotStatus(s,bookingMap.get(s.id),false)==='bookable').length
  const allEnded   = slots.every(s=>['ended','attended','missed','cancelled'].includes(getSlotStatus(s,bookingMap.get(s.id),false)))
  const nextSlot   = bookedSlot??slots.find(s=>s.status==='live')
    ??slots.find(s=>getSlotStatus(s,bookingMap.get(s.id),false)==='bookable')

  type S='live'|'booked'|'ended'|'open'
  const state: S = hasLive?'live':bookedSlot?'booked':allEnded?'ended':'open'
  const accentMap: Record<S,string> = { live:'#EF4444', booked:'#059669', ended:'var(--color-text-muted)', open:'#0057b8' }
  const accent = accentMap[state]

  return(
    <motion.button type="button" onClick={onClick}
      whileHover={{y:-2,boxShadow:'0 14px 36px rgba(15,23,42,0.10)'}}
      whileTap={{scale:0.985}}
      className="dm flex h-full w-full flex-col rounded-2xl text-left overflow-hidden"
      style={{
        background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
        borderTop:`3px solid ${accent}`,
        boxShadow:'0 2px 8px rgba(15,23,42,0.05)',
        opacity:allEnded?0.65:1,
      }}>

      {/* Status strip */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          {hasLive&&(
            <>
              <motion.span animate={{scale:[1,1.5,1],opacity:[0.8,0,0.8]}}
                transition={{duration:1.8,repeat:Infinity}}
                className="h-2 w-2 rounded-full flex-shrink-0" style={{background: 'var(--color-danger)'}}/>
              <span className="text-[9px] font-bold tracking-widest uppercase" style={{color: 'var(--color-danger)'}}>Live Now</span>
            </>
          )}
          {!hasLive&&bookedSlot&&(
            <div className="flex items-center gap-1">
              <CheckCircle2 size={9} style={{color: 'var(--color-success)'}} strokeWidth={3}/>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{color: 'var(--color-success)'}}>Reserved</span>
            </div>
          )}
          {!hasLive&&!bookedSlot&&bookable>0&&(
            <span className="text-[9px] font-bold uppercase tracking-wider" style={{color: 'var(--color-primary)'}}>{bookable} open</span>
          )}
          {allEnded&&<span className="text-[9px] font-bold uppercase tracking-wider" style={{color: 'var(--color-text-muted)'}}>Ended</span>}
        </div>
        {isOffline?(
          <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
            style={{background:'rgba(5,150,105,0.08)',color: 'var(--color-success)',border:'1px solid rgba(5,150,105,0.18)'}}>
            <Building2 size={7}/>In-Person
          </span>
        ):(
          <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
            style={{background:'rgba(99,102,241,0.08)',color: '#6366F1',border:'1px solid rgba(99,102,241,0.16)'}}>
            <Wifi size={7}/>Online
          </span>
        )}
      </div>

      {/* Title */}
      <div className="px-3.5 pb-2">
        <h3 className="syne line-clamp-2 text-[13px] font-700 leading-snug" style={{color:allEnded?'var(--color-text-muted)':'var(--color-text-primary)'}}>
          {titleCase(group.title)}
        </h3>
      </div>

      {/* Meta */}
      <div className="flex flex-col gap-1 px-3.5 pb-2">
        {courseTitle&&(
          <div className="flex items-center gap-1.5">
            <BookOpen size={9} style={{color: 'var(--color-text-muted)'}} className="flex-shrink-0"/>
            <span className="truncate text-[11px] sm:text-[10px]" style={{color: 'var(--color-text-muted)'}}>{titleCase(courseTitle)}</span>
            {isEnrolled
              ?<CheckCircle2 size={9} style={{color: 'var(--color-success)'}} className="ml-auto flex-shrink-0" strokeWidth={3}/>
              :<Lock size={9} style={{color: 'var(--color-text-muted)'}} className="ml-auto flex-shrink-0"/>}
          </div>
        )}
        {instructor&&(
          <div className="flex items-center gap-1.5">
            <User size={9} style={{color: 'var(--color-text-muted)'}} className="flex-shrink-0"/>
            <span className="truncate text-[11px] sm:text-[10px]" style={{color: 'var(--color-text-muted)'}}>{instructor.name}</span>
          </div>
        )}
        {isOffline&&(first as any)?.location&&(
          <div className="flex items-center gap-1.5">
            <MapPin size={9} style={{color: '#34D399'}} className="flex-shrink-0"/>
            <span className="truncate text-[11px] sm:text-[10px]" style={{color: 'var(--color-success)'}}>
              {(first as any).location}{(first as any).room?` · ${(first as any).room}`:''}
            </span>
          </div>
        )}
        {moduleTitle&&(
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full flex-shrink-0" style={{background: 'var(--color-primary)'}}/>
            <span className="truncate text-[11px] sm:text-[10px] font-medium" style={{color: 'var(--color-primary)'}}>{moduleTitle}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between px-3.5 py-2.5"
        style={{borderTop: '1px solid var(--color-border)'}}>
        {nextSlot?(
          <div className="flex items-center gap-1">
            <Clock size={9} style={{color:bookedSlot?'#059669':'var(--color-text-muted)'}}/>
            <span className="text-[11px] sm:text-[10px] font-semibold" style={{color:bookedSlot?'#059669':'var(--color-text-secondary)'}}>
              {fmtShortSlot(nextSlot.scheduledStart)}
            </span>
          </div>
        ):<div/>}
        <div className="flex items-center gap-1">
          <CalendarDays size={9} style={{color: 'var(--color-text-muted)'}}/>
          <span className="text-[9px]" style={{color: 'var(--color-text-muted)'}}>{slots.length}s</span>
        </div>
      </div>
    </motion.button>
  )
}

/* ── Slot modal ────────────────────────────────────────────── */
function SlotModal({group,bookingMap,onBook,onCancel,bookPending,cancelPending,onClose}: {
  group:ClassGroup; bookingMap:Map<string,MyBooking>
  onBook:(id:string)=>Promise<void>; onCancel:(id:string,label:string)=>Promise<void>
  bookPending:Set<string>; cancelPending:Set<string>; onClose:()=>void
}) {
  const {slots,bookedSlot,instructor,courseTitle,moduleTitle} = group
  const { data: currentUser } = useCurrentUser()
  const isPendingAny = currentUser?.enrollmentStatus === 'pending'
  const defaultId = useMemo(()=>{
    if(bookedSlot) return bookedSlot.id
    return slots.find(s=>{const st=getSlotStatus(s,bookingMap.get(s.id),false);return st==='bookable'||st==='live'})?.id??slots[0]?.id??null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  const [selectedId,setSelectedId] = useState<string|null>(defaultId)
  /* Server-anchored clock. Ticks every second only while a booked slot is
     within two minutes of its join window opening or closing, so the Join
     button appears on the start second; 30 s otherwise. */
  const now = useJoinClock(slots)
  useEffect(()=>{if(bookedSlot)setSelectedId(bookedSlot.id)},[bookedSlot?.id])
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()}
    window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h)
  },[onClose])

  const sel   = slots.find(s=>s.id===selectedId)??null
  const selBk = sel?bookingMap.get(sel.id):undefined
  const selSt = sel?getSlotStatus(sel,selBk,!!bookedSlot&&sel.id!==bookedSlot?.id):null
  const sAny  = sel as any
  const isOff = sAny?.isOnline===false
  const isEnr = sel?(sAny?.isEnrolled!==false):false
  const cfg   = selSt?SC[selSt]:null

  return(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}/>
      <motion.div initial={{opacity:0,y:40}} animate={{opacity:1,y:0}} exit={{opacity:0,y:40}}
        transition={{type:'spring',stiffness:360,damping:32}} onClick={e=>e.stopPropagation()}
        className="dm relative w-full overflow-y-auto bg-[var(--color-bg-surface)] sm:max-w-md"
        style={{borderRadius:'24px 24px 20px 20px',maxHeight:'92dvh',boxShadow:'0 -8px 48px rgba(15,23,42,0.20)'}}>
        <div className="flex justify-center pb-1 pt-3 sm:hidden">
          <div className="h-1 w-10 rounded-full" style={{background: 'var(--color-border-strong)'}}/>
        </div>
        <div className="px-5 pt-4 pb-4" style={{borderBottom: '1px solid var(--color-border)'}}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="syne text-[17px] font-700 leading-tight" style={{color: 'var(--color-text-primary)'}}>{titleCase(group.title)}</h2>
              {instructor&&<p className="mt-1 flex items-center gap-1 text-xs" style={{color: 'var(--color-text-muted)'}}><User size={10}/>{instructor.name}</p>}
              {courseTitle&&(
                <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{color: 'var(--color-text-muted)'}}>
                  <BookOpen size={9}/>{titleCase(courseTitle)}
                  {isEnr?<CheckCircle2 size={9} style={{color: 'var(--color-success)'}} className="ml-1" strokeWidth={3}/>
                        :<Lock size={9} style={{color: 'var(--color-text-muted)'}} className="ml-1"/>}
                </p>
              )}
              {moduleTitle&&(
                <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium" style={{color: 'var(--color-primary)'}}>
                  <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{background: 'var(--color-primary)'}}/>
                  {moduleTitle}
                </p>
              )}
              {isOff&&sAny?.location&&(
                <p className="mt-1 flex items-center gap-1 text-[11px]" style={{color: 'var(--color-success)'}}>
                  <MapPin size={9}/>{sAny.location}{sAny.room?` · ${sAny.room}`:''}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {slots[0]?.language&&(
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] sm:text-[10px] font-semibold"
                    style={{background:'rgba(5,150,105,0.08)',color: 'var(--color-success)',border:'1px solid rgba(5,150,105,0.18)'}}>
                    🌐 {slots[0].language}
                  </span>
                )}
                {isOff?(
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] sm:text-[10px] font-semibold"
                    style={{background:'rgba(5,150,105,0.08)',color: 'var(--color-success)',border:'1px solid rgba(5,150,105,0.18)'}}>
                    <Building2 size={9}/>In-Person
                  </span>
                ):(
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] sm:text-[10px] font-semibold"
                    style={{background:'rgba(99,102,241,0.08)',color: '#6366F1',border:'1px solid rgba(99,102,241,0.16)'}}>
                    <Wifi size={9}/>Online
                  </span>
                )}
              </div>
            </div>
            <button type="button" onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl hover:bg-[var(--color-bg-muted)] sm:h-8 sm:w-8">
              <X size={14} style={{color: 'var(--color-text-muted)'}}/>
            </button>
          </div>
        </div>
        <div className="px-5 pt-4 pb-3">
          <p className="mb-3 text-[11px] sm:text-[10px] font-bold uppercase tracking-widest" style={{color: 'var(--color-text-muted)'}}>
            {bookedSlot?'Your reservation · other times':'Choose a time slot'}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slots.map(lc=>{
              const bk=bookingMap.get(lc.id)
              const st=getSlotStatus(lc,bk,!!bookedSlot&&lc.id!==bookedSlot?.id)
              return<SlotChip key={lc.id} lc={lc} status={st} isSelected={selectedId===lc.id} onClick={()=>setSelectedId(lc.id)}/>
            })}
          </div>
        </div>
        {/* The bottom sheet ends at the bottom of the glass, so its last
            control needs to clear the home indicator. */}
        <div className="px-5 pt-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <AnimatePresence mode="wait">
            {sel&&selSt&&cfg&&(
              <motion.div key={sel.id+'-'+selSt}
                initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}}
                transition={{duration:0.12}} className="space-y-2">
                {selSt==='live'&&(()=>{
                  const booked=!!selBk&&(selBk.status==='booked'||selBk.status==='attended')
                  return(
                    <div className="rounded-2xl p-4" style={{background:cfg.bg,border:`1px solid ${cfg.border}`}}>
                      <div className="mb-2 flex items-center gap-2">
                        <motion.div animate={{opacity:[1,0.3,1]}} transition={{duration:1.2,repeat:Infinity}}>
                          <Radio size={14} style={{color:cfg.color}}/>
                        </motion.div>
                        <p className="syne text-[13px] font-700" style={{color:cfg.color}}>Class is Live Now</p>
                      </div>
                      {booked?(
                        /* How a booked student actually gets in, which depends
                           entirely on where the class runs:

                             in-app   — the room lives at /watch on this site
                             external — a Google Meet link, fetched on the click
                             in-person — there is nothing to join; go to the room

                           Until this branch existed, every one of those cases
                           was told to check their inbox for a join link. For an
                           in-app class no such email is sent (the scheduled-class
                           mail carries the COURSE url, not a join link), so the
                           one instruction on screen led nowhere. */
                        isOff?(
                          <div className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
                            style={{background:'rgba(5,150,105,0.08)',color: '#064E3B',border:'1px solid rgba(5,150,105,0.18)'}}>
                            <MapPin size={11} className="mr-1.5 inline" style={{color: 'var(--color-success)'}} strokeWidth={3}/>
                            Your seat is reserved. This class is in person
                            {sAny?.location?<> at <strong>{sAny.location}</strong></>:null}
                            {sAny?.room?<> · {sAny.room}</>:null}.
                          </div>
                        ):sel.type==='internal'?(
                          <Link href={`/live-classes/${sel.id}/watch`}
                            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white"
                            style={{background:cfg.color}}>
                            <Radio size={14}/>Join the Class
                          </Link>
                        ):(
                          /* External. 'live' starts 15 min BEFORE the class,
                             but the Meet link is released only from the start
                             (to start + 20 min) — so this shows "Join opens at"
                             first, then the button on the start second, then
                             "Join link closed". The button decides from the
                             server's window, not from this slot status. */
                          <div className="space-y-2">
                            <JoinMeetButton
                              sessionId={sel.id} now={now} size="lg" accent={cfg.color}
                              isBooked={sel.isBooked ?? booked}
                              joinOpensAt={sel.joinOpensAt} joinClosesAt={sel.joinClosesAt}
                              type={sel.type} isOnline={sel.isOnline} status={sel.status}
                              className="justify-center text-center"/>
                            <div className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
                              style={{background:'rgba(5,150,105,0.08)',color: '#064E3B',border:'1px solid rgba(5,150,105,0.18)'}}>
                              <CheckCircle2 size={11} className="mr-1.5 inline" style={{color: 'var(--color-success)'}} strokeWidth={3}/>
                              {/* Phase-aware, or it would promise a button under a
                                  "Join link closed" line. The minutes come from
                                  the server's two instants, never from a literal. */}
                              {(() => {
                                const opens  = sel.joinOpensAt  ? new Date(sel.joinOpensAt).getTime()  : NaN
                                const closes = sel.joinClosesAt ? new Date(sel.joinClosesAt).getTime() : NaN
                                const mins   = Number.isNaN(opens) || Number.isNaN(closes) ? 20 : Math.round((closes - opens) / 60_000)
                                if (!Number.isNaN(closes) && now > closes)
                                  return 'Your seat was reserved, but the join link has closed. If you are still expecting to attend, contact your admin.'
                                if (!Number.isNaN(opens) && now >= opens)
                                  return `Your seat is reserved and the class is on now. The join link stays open for ${mins} minutes after the start.`
                                return `Your seat is reserved. The join button unlocks at the class start time and stays open for ${mins} minutes.`
                              })()}
                            </div>
                          </div>
                        )
                      ):(
                        <p className="text-[11px] leading-relaxed" style={{color: 'var(--color-text-secondary)'}}>
                          Booking is closed. Only students who reserved beforehand receive an email join link.
                        </p>
                      )}
                    </div>
                  )
                })()}
                {selSt==='bookable'&&(
                  isEnr&&isPendingAny?(
                    <Link href="/complete-registration"
                      className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white"
                      style={{background: 'var(--color-primary)'}}>
                      <BookOpen size={14}/>Complete Registration to Book
                    </Link>
                  ):isEnr?(
                    <>
                    <motion.button type="button"
                      whileHover={{scale:1.01,boxShadow:'0 8px 28px rgba(0,87,184,0.32)'}}
                      whileTap={{scale:0.98}}
                      onClick={()=>onBook(sel.id)} disabled={bookPending.has(sel.id)}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-60"
                      style={{background: 'var(--color-primary)'}}>
                      {bookPending.has(sel.id)
                        ?<><Spinner size={14}/>Booking…</>
                        :<><BookOpen size={14}/>Reserve Seat · {fmtShortSlot(sel.scheduledStart)}</>}
                    </motion.button>
                    {/* The deadline, stated BEFORE they need it.

                        A student who finds out about the cut-off by being
                        refused has already lost the seat. Shown as a concrete
                        time rather than the policy — "seats close one hour
                        before" makes a reader do arithmetic against a class
                        time they are also reading off the screen — and it
                        sharpens into a countdown inside the last two hours,
                        which is the only window where the difference between
                        knowing and not knowing changes what they do. */}
                    {(()=>{
                      const closesAt = bookingClosedAt(sel)
                      const minsLeft = Math.round((closesAt - now)/60_000)
                      const urgent   = minsLeft <= 120
                      return (
                        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed"
                          style={{color: urgent ? '#B45309' : 'var(--color-text-muted)'}}>
                          <Clock size={11} style={{flexShrink:0}}/>
                          {urgent
                            ? <span>Booking closes in <strong>{minsLeft < 60 ? `${Math.max(1,minsLeft)} min` : `${Math.floor(minsLeft/60)}h ${minsLeft%60}m`}</strong> — reserve now to keep your seat.</span>
                            : <span>Reserve by <strong>{fmtTime(new Date(closesAt).toISOString())}</strong> — seats close one hour before the class starts.</span>}
                        </p>
                      )
                    })()}
                    </>
                  ):(
                    <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{background: 'var(--color-bg-inset)',border: '1px solid var(--color-border)'}}>
                      <Lock size={14} style={{color: 'var(--color-text-muted)',flexShrink:0,marginTop:1}}/>
                      <div>
                        <p className="text-[12px] font-semibold" style={{color: 'var(--color-text-secondary)'}}>Enroll to Reserve</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed" style={{color: 'var(--color-text-muted)'}}>
                          Purchase this course to reserve seats and get email join links before class.
                        </p>
                      </div>
                    </div>
                  )
                )}
                {selSt==='closed'&&(
                  <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{background: 'var(--color-bg-inset)',border: '1px solid var(--color-border)'}}>
                    <Clock size={14} style={{color: 'var(--color-text-muted)',flexShrink:0,marginTop:1}}/>
                    <div>
                      <p className="text-[12px] font-semibold" style={{color: 'var(--color-text-secondary)'}}>Booking Closed</p>
                      {/* Says WHEN it closed, not just that it did. A student
                          who missed it by minutes should be able to tell the
                          difference from one who missed it by a day. */}
                      <p className="mt-0.5 text-[11px] leading-relaxed" style={{color: 'var(--color-text-muted)'}}>
                        Seats closed at <strong>{fmtShortSlot(new Date(bookingClosedAt(sel)).toISOString())}</strong>,
                        an hour before the class. Ask your admin if you still need a place.
                      </p>
                    </div>
                  </div>
                )}
                {selSt==='booked'&&selBk&&(()=>{
                  const msLeft=new Date(sel.scheduledStart).getTime()-now
                  const mins=Math.max(0,Math.ceil(msLeft/60_000))
                  return(
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-2xl px-4 py-2.5" style={{background:cfg.bg,border:`1px solid ${cfg.border}`}}>
                        <CheckCircle2 size={14} style={{color:cfg.color}} strokeWidth={3}/>
                        <p className="text-[12px] font-semibold" style={{color:cfg.color}}>Reserved · {fmtSlotLabel(sel.scheduledStart,sel.durationMins)}</p>
                      </div>
                      <div className="rounded-2xl px-4 py-3 text-[11px] leading-relaxed" style={{background: 'var(--color-bg-inset)',border: '1px solid var(--color-border)',color: 'var(--color-text-secondary)'}}>
                        <Clock size={11} className="mr-1.5 inline" style={{color: 'var(--color-text-muted)'}}/>
                        {mins<=5?'Join link sent. Check your inbox!':<>Your <strong>join link will be emailed 5 min before</strong> class.</>}
                      </div>
                      {/* Online seat, ahead of the window: says when the in-app
                          Join button unlocks (renders nothing for in-person). */}
                      <JoinMeetButton
                        sessionId={sel.id} now={now} size="lg"
                        isBooked={sel.isBooked ?? true}
                        joinOpensAt={sel.joinOpensAt} joinClosesAt={sel.joinClosesAt}
                        type={sel.type} isOnline={sel.isOnline} status={sel.status}
                        className="justify-center px-1"/>
                      {!(isOff && offlineDayOffset(sel.scheduledStart) === 0) && (
                        <button type="button" onClick={()=>onCancel(selBk.id,fmtShortSlot(sel.scheduledStart))} disabled={cancelPending.has(selBk.id)}
                          className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-2 text-xs font-medium disabled:opacity-50"
                          style={{color: 'var(--color-danger)',border:'1px solid rgba(239,68,68,0.18)'}}>
                          {cancelPending.has(selBk.id)?<Spinner size={11}/>:<X size={11}/>}Cancel reservation
                        </button>
                      )}
                    </div>
                  )
                })()}
                {selSt==='full'&&(
                  <div className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm" style={{background: 'var(--color-bg-inset)',color: 'var(--color-text-muted)',border: '1px solid var(--color-border)'}}>
                    <Users size={14}/>Fully booked
                  </div>
                )}
                {selSt==='locked'&&(
                  isOff && offlineDayOffset(sel.scheduledStart) === 0 ? (
                    <div className="flex items-start gap-2 rounded-2xl px-4 py-3" style={{background:'rgba(99,102,241,0.06)',border:'1px solid rgba(99,102,241,0.18)'}}>
                      <Lock size={14} style={{color: '#6366F1',flexShrink:0,marginTop:1}}/>
                      <div>
                        <p className="text-[12px] font-semibold" style={{color: '#4338CA'}}>Same-day registration closed</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed" style={{color: '#6366F1'}}>
                          Bookings must be made at least <strong>1 day in advance</strong>. Register tomorrow for an upcoming session.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-2xl px-4 py-3" style={{background: 'var(--color-primary-light)',border:'1px solid rgba(217,119,6,0.25)'}}>
                      <AlertCircle size={14} style={{color: '#D97706',flexShrink:0,marginTop:1}}/>
                      <span className="text-xs" style={{color: '#92400E'}}>You already have a reservation. Cancel it first to pick a different time.</span>
                    </div>
                  )
                )}
                {selSt==='attended'&&(
                  <div className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold"
                    style={{background:'rgba(37,99,235,0.07)',color: '#1D4ED8',border:'1px solid rgba(37,99,235,0.18)'}}>
                    <CheckCircle2 size={14} strokeWidth={3}/>Attended! Great work!
                  </div>
                )}
                {selSt==='missed'&&(
                  <div className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm"
                    style={{background:'rgba(217,119,6,0.07)',color: '#92400E',border:'1px solid rgba(217,119,6,0.20)'}}>
                    <AlertCircle size={14}/>Missed this session
                  </div>
                )}
                {selSt==='ended'&&(
                  sel.recordingUrl?(
                    <a href={sel.recordingUrl} target="_blank" rel="noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-medium"
                      style={{background: 'var(--color-bg-inset)',color: 'var(--color-text-secondary)',border: '1px solid var(--color-border)'}}>
                      <Video size={13}/>Watch Recording
                    </a>
                  ):(
                    <div className="flex items-center justify-center rounded-2xl py-3 text-xs"
                      style={{background: 'var(--color-bg-inset)',color: 'var(--color-text-muted)',border: '1px solid var(--color-border)'}}>
                      Session ended · no recording
                    </div>
                  )
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Course dropdown ───────────────────────────────────────── */
function CourseDropdown({ value, onChange, options }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const active = value !== 'all'
  const selected = options.find(o => o.value === value)
  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const pos = useAnchoredPosition(open, btnRef)
  const toggleOpen = () => setOpen(v => !v)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        dropRef.current && !dropRef.current.contains(e.target as Node)
      ) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        className="dm flex items-center gap-1.5 rounded-2xl py-2 pl-3 pr-8 text-[12px] font-semibold outline-none cursor-pointer transition-all whitespace-nowrap"
        style={{
          background: active ? 'rgba(0,87,184,0.08)' : 'var(--color-bg-surface)',
          color:      active ? '#EA6010' : '#475569',
          border:     active ? '1.5px solid rgba(0,87,184,0.30)' : '1px solid var(--color-border)',
          boxShadow:  active ? '0 0 0 3px rgba(0,87,184,0.07)' : '0 1px 4px rgba(15,23,42,0.04)',
        }}
      >
        <BookOpen size={12} style={{ color: active ? '#0057b8' : 'var(--color-text-muted)', flexShrink: 0 }} />
        <span className="max-w-[130px] truncate">{selected ? selected.label : 'All Courses'}</span>
        <ChevronDown size={11} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
          style={{ color: active ? '#0057b8' : 'var(--color-text-muted)' }} />
      </button>

      <AnimatePresence>
        {open && pos.visible && (
          <motion.div
            ref={dropRef}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 9999,
              minWidth: 210,
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 32px rgba(15,23,42,0.12)',
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            {options.length > 5 && (
              <div className="p-2 border-b border-slate-100">
                <div className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 bg-[var(--color-bg-muted)] border border-slate-100">
                  <Search size={11} style={{ color: 'var(--color-text-muted)' }} />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search courses…"
                    autoFocus
                    className="dm flex-1 bg-transparent text-[16px] outline-none placeholder:text-slate-400 sm:text-[12px]"
                    style={{ color: 'var(--color-text-primary)' }}
                  />
                </div>
              </div>
            )}
            <div className="py-1.5 max-h-52 overflow-y-auto">
              <button
                type="button"
                onClick={() => { onChange('all'); setOpen(false); setQuery('') }}
                className="dm flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--color-hover)]"
                style={{ color: value === 'all' ? '#0057b8' : '#475569' }}
              >
                <div className="h-5 w-5 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--color-bg-subtle)' }}>
                  <BookOpen size={10} style={{ color: 'var(--color-text-muted)' }} />
                </div>
                <span>All Courses</span>
                {value === 'all' && <span className="ml-auto text-blue-500 text-[11px] sm:text-[10px]">✓</span>}
              </button>
              {filtered.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); setQuery('') }}
                  className="dm flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--color-hover)]"
                  style={{ color: value === o.value ? '#0057b8' : '#475569' }}
                >
                  <div className="h-5 w-5 rounded-lg flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
                    style={{ background: 'var(--color-primary)' }}>
                    {o.label[0]?.toUpperCase()}
                  </div>
                  <span className="truncate">{o.label}</span>
                  {value === o.value && <span className="ml-auto text-blue-500 text-[11px] sm:text-[10px] flex-shrink-0">✓</span>}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="dm px-3 py-3 text-center text-[11px] text-slate-400">No results</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Language dropdown ─────────────────────────────────────── */
/* THE SAME FIVE THE BACKEND ACCEPTS - see LIVE_LANGUAGES in
   backend/src/routes/admin.routes.ts:1363, which the create and update
   validators enforce. This list had drifted in both directions at once:
   it offered Tamil, which no class can be, so picking it could only ever
   empty the page; and it omitted Arabic and Urdu, which a class CAN be,
   so those sessions were unreachable from the filter entirely. */
const LANG_OPTIONS = [
  { value: 'English',   label: 'English',   flag: '🇬🇧' },
  { value: 'Arabic',    label: 'Arabic',    flag: '🇦🇪' },
  { value: 'Hindi',     label: 'Hindi',     flag: '🇮🇳' },
  { value: 'Malayalam', label: 'Malayalam', flag: '🇮🇳' },
  { value: 'Urdu',      label: 'Urdu',      flag: '🇵🇰' },
]

function LanguageDropdown({ value, onChange }: {
  value: string; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const active = value !== 'all'
  const selected = LANG_OPTIONS.find(o => o.value === value)

  const pos = useAnchoredPosition(open, btnRef)
  const toggleOpen = () => setOpen(v => !v)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        dropRef.current && !dropRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        className="dm flex items-center gap-1.5 rounded-2xl py-2 pl-3 pr-8 text-[12px] font-semibold outline-none cursor-pointer transition-all whitespace-nowrap"
        style={{
          background: active ? 'rgba(0,87,184,0.08)' : 'var(--color-bg-surface)',
          color:      active ? '#EA6010' : '#475569',
          border:     active ? '1.5px solid rgba(0,87,184,0.30)' : '1px solid var(--color-border)',
          boxShadow:  active ? '0 0 0 3px rgba(0,87,184,0.07)' : '0 1px 4px rgba(15,23,42,0.04)',
        }}
      >
        {selected
          ? <span className="text-sm leading-none flex-shrink-0">{selected.flag}</span>
          : <Globe size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
        <span>{selected ? selected.label : 'All Languages'}</span>
        <ChevronDown size={11} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
          style={{ color: active ? '#0057b8' : 'var(--color-text-muted)' }} />
      </button>

      <AnimatePresence>
        {open && pos.visible && (
          <motion.div
            ref={dropRef}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 9999,
              minWidth: 170,
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 32px rgba(15,23,42,0.12)',
              borderRadius: 16,
              overflow: 'hidden',
              paddingTop: 6,
              paddingBottom: 6,
            }}
          >
            <button
              type="button"
              onClick={() => { onChange('all'); setOpen(false) }}
              className="dm flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--color-hover)]"
              style={{ color: value === 'all' ? '#0057b8' : '#475569' }}
            >
              <div className="h-5 w-5 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--color-bg-subtle)' }}>
                <Globe size={10} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <span>All Languages</span>
              {value === 'all' && <span className="ml-auto text-blue-500 text-[11px] sm:text-[10px]">✓</span>}
            </button>
            {LANG_OPTIONS.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className="dm flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--color-hover)]"
                style={{ color: value === o.value ? '#0057b8' : '#475569' }}
              >
                <span className="text-sm leading-none w-5 text-center flex-shrink-0">{o.flag}</span>
                <span>{o.label}</span>
                {value === o.value && <span className="ml-auto text-blue-500 text-[11px] sm:text-[10px]">✓</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Instructor filter with photo ──────────────────────────── */
function InstructorFilterSelect({ value, onChange, instructors }: {
  value: string
  onChange: (v: string) => void
  instructors: { id: string; name: string; avatarUrl?: string }[]
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const active = value !== 'all'
  const selected = instructors.find(i => i.id === value)

  const pos = useAnchoredPosition(open, btnRef)
  const toggleOpen = () => setOpen(v => !v)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        dropRef.current && !dropRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        className="dm flex items-center gap-2 rounded-2xl py-2 pl-3 pr-8 text-[12px] font-semibold outline-none cursor-pointer transition-all whitespace-nowrap"
        style={{
          background: active ? 'rgba(0,87,184,0.08)' : 'var(--color-bg-surface)',
          color:      active ? '#EA6010'              : '#475569',
          border:     active ? '1.5px solid rgba(0,87,184,0.30)' : '1px solid var(--color-border)',
          boxShadow:  active ? '0 0 0 3px rgba(0,87,184,0.07)' : '0 1px 4px rgba(15,23,42,0.04)',
        }}
      >
        {selected ? (
          <>
            <AvatarImg src={selected.avatarUrl}
              className="h-5 w-5 rounded-full object-cover flex-shrink-0"
              fallback={<div className="h-5 w-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white" style={{ background: 'var(--color-primary)' }}>
                  {selected.name[0]?.toUpperCase()}
                </div>} />
            <span className="max-w-[110px] truncate">{selected.name}</span>
          </>
        ) : (
          <span>All Instructors</span>
        )}
        <ChevronDown size={11} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: active ? '#0057b8' : 'var(--color-text-muted)' }} />
      </button>

      <AnimatePresence>
        {open && pos.visible && (
          <motion.div
            ref={dropRef}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 9999,
              minWidth: 190,
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 32px rgba(15,23,42,0.12)',
              borderRadius: 16,
              overflow: 'hidden',
              paddingTop: 6,
              paddingBottom: 6,
            }}
          >
            <button
              type="button"
              onClick={() => { onChange('all'); setOpen(false) }}
              className="dm flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--color-hover)]"
              style={{ color: value === 'all' ? '#0057b8' : '#475569' }}
            >
              <div className="h-6 w-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--color-bg-subtle)' }}>
                <User size={11} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              All Instructors
            </button>
            {instructors.map(i => (
              <button
                key={i.id}
                type="button"
                onClick={() => { onChange(i.id); setOpen(false) }}
                className="dm flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--color-hover)]"
                style={{ color: value === i.id ? '#0057b8' : '#475569' }}
              >
                <AvatarImg src={i.avatarUrl}
                  className="h-6 w-6 rounded-full object-cover flex-shrink-0 ring-1 ring-slate-200"
                  fallback={<div className="h-6 w-6 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] sm:text-[10px] font-bold text-white" style={{ background: 'var(--color-primary)' }}>
                      {i.name[0]?.toUpperCase()}
                    </div>} />
                <span className="truncate">{i.name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Contact admin modal ───────────────────────────────────── */
function ContactAdminModal({onClose}:{onClose:()=>void}) {
  return(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}/>
      <motion.div initial={{opacity:0,scale:0.93}} animate={{opacity:1,scale:1}}
        exit={{opacity:0,scale:0.93}} onClick={e=>e.stopPropagation()}
        className="dm relative w-full max-w-sm rounded-3xl bg-[var(--color-bg-surface)] p-6 text-center"
        style={{boxShadow:'0 24px 64px rgba(15,23,42,0.18)'}}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{background:'rgba(0,87,184,0.08)',border:'1px solid rgba(0,87,184,0.20)'}}>
          <AlertCircle size={22} style={{color: 'var(--color-primary)'}}/>
        </div>
        <h3 className="syne mb-2 text-base font-700" style={{color: 'var(--color-text-primary)'}}>Attendance Limit Reached</h3>
        <p className="mb-5 text-sm leading-relaxed" style={{color: 'var(--color-text-secondary)'}}>
          You&apos;ve attended this class twice. Please contact the admin team for additional access.
        </p>
        <button type="button" onClick={onClose}
          className="w-full rounded-2xl py-3 text-sm font-bold text-white"
          style={{background: 'var(--color-primary)'}}>Got it</button>
      </motion.div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════ */
/* ─────────────────────────────────────────────────────
   Summary metric tile.

   Each of the four used to paint its own tinted background and matching
   border — white, red, green, blue side by side — so a row that reports one
   thing in four ways read as four unrelated widgets. The surface is now
   identical across all of them and the accent survives where it carries
   meaning: a small indicator badge behind the icon. The value itself is
   charcoal in every tile, which is both higher contrast than the tinted
   version and lets the eye compare the numbers instead of the colours.
───────────────────────────────────────────────────── */
function MetricTile({ icon, label, value, accent, pulse = false, index = 0 }: {
  icon: React.ReactNode; label: string; value: number | string
  accent: string; pulse?: boolean; index?: number
}) {
  return (
    <motion.div
      initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:index*0.05}}
      className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
      style={{
        background: 'var(--color-bg-surface)',
        boxShadow: '0 1px 2px rgba(13,15,26,0.04), 0 8px 24px -12px rgba(13,15,26,0.10)',
      }}>
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${accent}14`, color: accent }}>
        {pulse
          ? <motion.div animate={{opacity:[1,0.35,1]}} transition={{duration:1.5,repeat:Infinity}}>{icon}</motion.div>
          : icon}
      </div>
      <div className="min-w-0">
        <p className="syne text-[24px] font-800 leading-none tabular-nums"
          style={{color:'var(--color-text-primary)'}}>{value}</p>
        {/* Wraps rather than truncates on a phone: "Total Classes" and "My
            Reservations" were both losing their ends in a 4-across grid, and
            a metric whose label is cut is a metric you have to guess at.
            Truncation returns at `sm`, where the tiles are wide enough. */}
        <p className="dm mt-1.5 text-[11px] font-semibold uppercase leading-tight tracking-wider sm:truncate sm:text-[10px]"
          style={{color:'var(--color-text-muted)'}}>{label}</p>
      </div>
    </motion.div>
  )
}

export default function ClassBookingsPage() {
  const [rangeStart, setRangeStart] = useState<Date>(()=>getMondayOfWeek(new Date()))
  const [rangeEnd,   setRangeEnd]   = useState<Date>(()=>addDays(getMondayOfWeek(new Date()),6))
  const [showCal,    setShowCal]    = useState(false)
  const [showPanel,  setShowPanel]  = useState(false)

  const [search,           setSearch]           = useState('')
  const [filterStatus,     setFilterStatus]     = useState<StatusFilter>('all')
  const [filterAccess,     setFilterAccess]     = useState<AccessFilter>('all')
  const [filterDelivery,   setFilterDelivery]   = useState<DeliveryFilter>('all')
  const [filterProgram,    setFilterProgram]    = useState<ProgramFilter>('all')
  const [filterCourse,     setFilterCourse]     = useState('all')
  const [filterInstructor, setFilterInstructor] = useState('all')
  const [filterLanguage,   setFilterLanguage]   = useState('all')

  /* ── WHICH VIEW, AND WHERE IN IT ─────────────────────────────────────
     'courses' is the catalogue: Course -> Module -> Class. 'sessions' is the
     chronological list this page has always been. The hierarchy lands first
     because that is how the schedule is meant to be read now, but every
     reminder email, digest and booking notice links to a SPECIFIC session, so
     those all carry ?view=sessions and keep arriving at the flat list.

     Held in the URL rather than only in React so a drill-down can be linked,
     bookmarked and backed out of. Read on mount rather than during render:
     `window` does not exist server-side, and seeding state from it directly
     would make the first client render disagree with the server's. */
  const [view,    setView]    = useState<'courses'|'sessions'>('courses')
  const [hCourse, setHCourse] = useState<string|null>(null)
  const [hModule, setHModule] = useState<string|null>(null)

  const [openKey,    setOpenKey]    = useState<GroupKey|null>(null)
  const [showAdmin,  setShowAdmin]  = useState(false)
  const [bookPending,setBookPending]= useState<Set<string>>(new Set())
  const [cancelPend, setCancelPend] = useState<Set<string>>(new Set())

  /* URL -> state, on mount and on every back/forward. */
  useEffect(()=>{
    const read=()=>{
      const q=new URLSearchParams(window.location.search)
      setView(q.get('view')==='sessions'?'sessions':'courses')
      setHCourse(q.get('course'))
      setHModule(q.get('module'))
    }
    read()
    window.addEventListener('popstate',read)
    return ()=>window.removeEventListener('popstate',read)
  },[])

  /* state -> URL. `push` for a navigation the back button should undo,
     `replace` for the view toggle, which is a preference rather than a place. */
  const syncUrl=(v:'courses'|'sessions',c:string|null,m:string|null,mode:'push'|'replace')=>{
    const q=new URLSearchParams(window.location.search)
    v==='sessions' ? q.set('view','sessions') : q.delete('view')
    c ? q.set('course',c) : q.delete('course')
    m !== null ? q.set('module',m) : q.delete('module')
    const url=q.toString()?`${window.location.pathname}?${q}`:window.location.pathname
    window.history[mode==='push'?'pushState':'replaceState'](null,'',url)
  }

  const navigate=(c:string|null,m:string|null)=>{
    setHCourse(c); setHModule(m); syncUrl('courses',c,m,'push')
    window.scrollTo({top:0,behavior:'smooth'})
  }
  const switchView=(v:'courses'|'sessions')=>{
    setView(v)
    if(v==='sessions'){ setHCourse(null); setHModule(null) }
    syncUrl(v, v==='sessions'?null:hCourse, v==='sessions'?null:hModule, 'replace')
  }

  const calRef   = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const toast    = useToast()

  const {data:allClasses=[],isLoading:loadCls} = useAllLiveClasses()
  const {data:bkData,         isLoading:loadBk}  = useMyBookings({per_page:100})
  const myBookings: MyBooking[] = bkData?.docs ?? []

  const bookingMap = useMemo(()=>{
    const m = new Map<string,MyBooking>()
    myBookings.forEach(b=>{
      const id = typeof b.liveClassId==='object'
        ?(b.liveClassId?.id??(b.liveClassId as any)?._id)
        :b.liveClassId
      if(id) m.set(id,b)
    })
    return m
  },[myBookings])

  /* Close popups on outside click */
  useEffect(()=>{
    const h=(e:MouseEvent)=>{
      if(calRef.current&&!calRef.current.contains(e.target as Node)) setShowCal(false)
      if(panelRef.current&&!panelRef.current.contains(e.target as Node)) setShowPanel(false)
    }
    document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h)
  },[])

  /* ── Unique courses & instructors ── */
  const uniqueCourses = useMemo(()=>{
    const map = new Map<string,{id:string;title:string;count:number}>()
    allClasses.forEach(lc=>{
      /* The course the STUDENT reaches this class through, which on a shared
         class is their own academy's rather than the host's. Listing the
         host's here put a course in the filter that the student is not
         enrolled in, and hid the one they are. */
      const id    = effCourseId(lc)
      const title = lc.yourCohort?.courseTitle ?? lc.course?.title
      if(!id || !title) return
      const ex = map.get(id)
      if(ex) ex.count++
      else map.set(id,{id,title,count:1})
    })
    return Array.from(map.values()).sort((a,b)=>b.count-a.count)
  },[allClasses])

  const uniqueInstructors = useMemo(()=>{
    const map = new Map<string,{id:string;name:string;avatarUrl?:string;count:number}>()
    allClasses.forEach(lc=>{
      if(!lc.instructor?.id) return
      const ex = map.get(lc.instructor.id)
      if(ex) ex.count++
      else map.set(lc.instructor.id,{id:lc.instructor.id,name:lc.instructor.name??'',avatarUrl:lc.instructor.avatarUrl,count:1})
    })
    return Array.from(map.values()).sort((a,b)=>b.count-a.count)
  },[allClasses])

  const programCounts = useMemo(()=>{
    const c:Record<string,number> = {'4x-trading':0,'digital-marketing':0,'ai':0,'jura':0}
    allClasses.forEach(lc=>{const p=effProgram(lc);if(p&&p in c)c[p]++})
    return c
  },[allClasses])

  /* Program-scoped course & instructor options for dropdowns */
  const programCourses = useMemo(()=>{
    if(filterProgram==='all') return uniqueCourses
    return uniqueCourses.filter(c=>allClasses.some(lc=>effCourseId(lc)===c.id&&effProgram(lc)===filterProgram))
  },[uniqueCourses,filterProgram,allClasses])

  const programInstructors = useMemo(()=>{
    if(filterProgram==='all') return uniqueInstructors
    return uniqueInstructors.filter(ins=>allClasses.some(lc=>lc.instructor?.id===ins.id&&effProgram(lc)===filterProgram))
  },[uniqueInstructors,filterProgram,allClasses])

  /* Reset course & instructor when program changes */
  useEffect(()=>{ setFilterCourse('all'); setFilterInstructor('all') },[filterProgram])

  /* ── Status counts for tabs ── */
  const statusCounts = useMemo(()=>{
    let live=0, upcoming=0, ended=0, today=0
    allClasses.forEach(lc=>{
      const a = lc as any
      const isOffline = a.isOnline === false
      if(filterDelivery==='online'  && isOffline)  return
      if(filterDelivery==='offline' && !isOffline) return
      // Apply content filters so tab counts match what renders
      if(filterProgram!=='all'    && effProgram(lc)!==filterProgram)   return
      if(filterCourse!=='all'     && effCourseId(lc)!==filterCourse)                return
      if(filterInstructor!=='all' && lc.instructor?.id!==filterInstructor)        return
      if(filterLanguage!=='all'   && (lc as any).language!==filterLanguage)       return

      if(isOffline) {
        if(lc.status==='cancelled') { ended++; return }
        const offset = offlineDayOffset(lc.scheduledStart)
        if(lc.status==='ended' || offset < 0) { ended++; return }
        if(offset > 0) { upcoming++; return }
        today++   // offset === 0 → today
        return
      }
      // Online
      const isLiveNow = lc.status==='live'||(!isPastEnd(lc)&&isWithinLiveWindow(lc))
      if(isLiveNow) { live++; return }
      if(lc.status==='ended'||lc.status==='cancelled'||isPastEnd(lc)) { ended++; return }
      upcoming++
    })
    return {live,upcoming,ended,today}
  },[allClasses,filterDelivery,filterProgram,filterCourse,filterInstructor,filterLanguage])

  /* ── Offline dashboard stats ── */
  const offlineStats = useMemo(()=>{
    const offline = allClasses.filter(lc=>(lc as any).isOnline===false)
    const todayStr = toZonedDateStr(new Date())
    const now = Date.now()
    const todayCount = offline.filter(lc=>toZonedDateStr(new Date(lc.scheduledStart))===todayStr).length
    const myReservations = offline.filter(lc=>bookingMap.get(lc.id)?.status==='booked').length
    const availableSeats = offline
      .filter(lc=>lc.status==='scheduled'&&!isPastEnd(lc)&&!isWithinLiveWindow(lc))
      .reduce((sum,lc)=>sum+Math.max(0,seatsLeft(lc)),0)
    return{total:offline.length,today:todayCount,myReservations,availableSeats}
  },[allClasses,bookingMap])

  /* ── Filtered classes ── */
  const filteredClasses = useMemo(()=>{
    const q = search.trim().toLowerCase()
    return allClasses.filter(lc=>{
      const a = lc as any
      /* THE SCHEDULE IS WHAT IS ON, NOT WHAT WAS.

         The default tab applied no time filter at all, so a database with a
         hundred finished classes behind it opened on a hundred things nobody
         can book. You cannot reserve a seat in a class that has ended, and a
         student looking for what they ATTENDED is asking a different question
         on a different screen — My Bookings, which is a full history.

         So 'All' now means all of what is still ahead. 'Completed' is
         untouched and is still the way to look back from here; nothing is
         unreachable, it is simply no longer the first thing you see. */
      if(filterStatus==='all'){
        const finished = a.isOnline===false
          ? (lc.status==='ended' || lc.status==='cancelled' || offlineDayOffset(lc.scheduledStart) < 0)
          : (lc.status==='ended' || lc.status==='cancelled' || isPastEnd(lc))
        if(finished) return false
      }
      // Status filter
      if(filterStatus==='live'){
        if(filterDelivery==='offline'){
          // In-Person "Today" tab — show all of today's in-person classes
          if(toZonedDateStr(new Date(lc.scheduledStart))!==toZonedDateStr(new Date())) return false
        } else {
          const isLiveNow=lc.status==='live'||(!isPastEnd(lc)&&isWithinLiveWindow(lc))
          if(!isLiveNow) return false
        }
      }
      if(filterStatus==='upcoming'){
        if(a.isOnline===false){
          // Offline: upcoming = strictly future calendar day (not today)
          if(lc.status==='cancelled') return false
          const offset = offlineDayOffset(lc.scheduledStart)
          if(offset <= 0) return false   // today or past = not upcoming
        } else {
          const isUpcoming=lc.status==='scheduled'&&!isWithinLiveWindow(lc)&&!isPastEnd(lc)
          if(!isUpcoming) return false
        }
      }
      if(filterStatus==='ended'){
        if(a.isOnline===false){
          // Offline: ended = past calendar day (not today, not future)
          const isEndedOffline=lc.status==='ended'||lc.status==='cancelled'||offlineDayOffset(lc.scheduledStart)<0
          if(!isEndedOffline) return false
        } else {
          const isEnded=lc.status==='ended'||lc.status==='cancelled'||isPastEnd(lc)
          if(!isEnded) return false
        }
      }
      // Delivery filter
      if(filterDelivery==='online'  &&a.isOnline===false) return false
      if(filterDelivery==='offline' &&a.isOnline!==false) return false
      // Other filters
      if(filterAccess==='mine'       && !a.isEnrolled)                      return false
      if(filterProgram!=='all'       && effProgram(lc)!==filterProgram) return false
      if(filterCourse!=='all'        && effCourseId(lc)!==filterCourse)                return false
      if(filterInstructor!=='all'    && lc.instructor?.id!==filterInstructor)        return false
      if(filterLanguage!=='all'      && (lc as any).language!==filterLanguage)       return false
      // Search
      if(q){
        /* Search the names the CALLER sees. This matched the host's course and
           module titles, so a guest student searching for their own module —
           the only one they have ever been shown — matched nothing. Both
           names are included rather than swapped: a host's title is still the
           right answer for every unshared class, and for a guest the two are
           simply different words for the same room. */
        const hay = [
          lc.title,
          lc.instructor?.name ?? '',
          lc.yourCohort?.courseTitle ?? '', lc.course?.title ?? '',
          effSectionTitle(lc) ?? '',
        ]
        if(!hay.join(' ').toLowerCase().includes(q)) return false
      }
      return true
    })
  },[allClasses,search,filterStatus,filterAccess,filterDelivery,filterProgram,filterCourse,filterInstructor,filterLanguage])

  const rangeEndIncl = useMemo(()=>{const d=new Date(rangeEnd);d.setHours(23,59,59,999);return d},[rangeEnd])

  /* ── When status is live/upcoming/ended OR in-person mode OR any content filter active, bypass date range ── */
  const useWindowRange = filterStatus==='all' && filterDelivery!=='offline' && filterProgram==='all' && filterCourse==='all' && filterInstructor==='all' && filterLanguage==='all'
  const windowClasses = useMemo(()=>{
    if(!useWindowRange) return filteredClasses
    return filteredClasses.filter(lc=>{const d=new Date(lc.scheduledStart);return d>=rangeStart&&d<=rangeEndIncl})
  },[filteredClasses,useWindowRange,rangeStart,rangeEndIncl])

  const allGroups = useMemo(():ClassGroup[]=>{
    const map = new Map<string,LiveClass[]>()
    /* Bucket by the class IDENTITY, not the title alone. Two sessions only
       belong to the same card when their title, instructor, course AND module
       all match — a real weekly repeat. Keying by title alone merged a class
       for instructor A into instructor B's bucket, and slots[0] (the earliest)
       then stamped B's name/course/module on the whole group. */
    windowClasses.forEach(lc=>{const k=[lc.title.trim(),lc.instructor?.id??'',effCourseId(lc)??'',effSectionId(lc)].join('|');if(!map.has(k))map.set(k,[]);map.get(k)!.push(lc)})
    const res:ClassGroup[] = []
    map.forEach((slots,id)=>{
      slots.sort((a,b)=>new Date(a.scheduledStart).getTime()-new Date(b.scheduledStart).getTime())
      const bookedSlot = slots.find(s=>bookingMap.get(s.id)?.status==='booked')
      res.push({id, title:slots[0].title.trim(), instructor:slots[0].instructor??null, slots, bookedSlot,
        courseId:effCourseId(slots[0]), courseTitle:slots[0].yourCohort?.courseTitle ?? slots[0].course?.title,
        moduleTitle:effSectionTitle(slots[0])})
    })
    res.sort((a,b)=>{
      const r=(g:ClassGroup)=>g.slots.some(s=>s.status==='live')?0:g.bookedSlot?1:2
      return r(a)-r(b)
    })
    return res
  },[windowClasses,bookingMap])

  const dateSections = useMemo(():DateSection[]=>{
    const by = new Map<string,ClassGroup[]>()
    const tod = new Date()
    allGroups.forEach(g=>{
      const firstSlot=useWindowRange
        ?g.slots.filter(s=>{const d=new Date(s.scheduledStart);return d>=rangeStart&&d<=rangeEndIncl})
          .sort((a,b)=>new Date(a.scheduledStart).getTime()-new Date(b.scheduledStart).getTime())[0]
        :g.slots.sort((a,b)=>new Date(a.scheduledStart).getTime()-new Date(b.scheduledStart).getTime())[0]
      if(!firstSlot) return
      /* Bucket by the STUDENT'S day (zonedKey = device zone), matching the
         label on each card — a session at 02:00 UTC files under the 20th for
         a Dubai student but under the 19th for one in New York, and each sees
         the day header agree with the card underneath it. */
      const dk = zonedKey(new Date(firstSlot.scheduledStart))
      if(!by.has(dk)) by.set(dk,[])
      by.get(dk)!.push(g)
    })
    return Array.from(by.keys()).sort().map(dk=>{
      const [y,mo,d]=dk.split('-').map(Number)
      /* The key names a calendar day, so derive its weekday AT UTC from a
         UTC-built Date — formatter and key can then never disagree, in any
         device zone (rendering noon UTC in a UTC+13 zone would slip a day). */
      const date = new Date(Date.UTC(y!, mo!-1, d!, 12))
      const dateLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric',
      }).format(date)
      return{dateKey:dk,dateLabel,isToday:dk===zonedKey(tod),groups:by.get(dk)!}
    })
  },[allGroups,rangeStart,rangeEndIncl,useWindowRange])

  /* THE CATALOGUE — every session still ahead, unclipped by the week window.
     The hierarchy is a catalogue, not a diary (lib/classSchedule.isStillAhead),
     so it deliberately does NOT go through `windowClasses`. It is built from
     the same `allClasses` the flat list starts from, which is what keeps the
     two views agreeing about any given class. */
  const catalog = useMemo(()=>buildCatalog(allClasses,bookingMap),[allClasses,bookingMap])

  /* A group the modal is open on can come from either view, and the two index
     it differently: the flat list nests groups under a date, the hierarchy
     under a module. Resolved against the flat list first, then the catalogue,
     so the same SlotModal serves both without either knowing about the other. */
  const openGroup = useMemo(()=>{
    if(!openKey) return null
    const dated = dateSections.find(s=>s.dateKey===openKey.dateKey)?.groups.find(g=>g.id===openKey.id)
    if(dated) return dated
    return allGroupsIn(catalog).find(g=>g.id===openKey.id) ?? null
  },[openKey,dateSections,catalog])

  /* ── Stats ── */
  const stats = useMemo(()=>{
    let liveNow=0,open=0,myBooked=0
    allClasses.forEach(lc=>{const st=getSlotStatus(lc,bookingMap.get(lc.id),false);if(st==='live')liveNow++;if(st==='bookable')open++})
    bookingMap.forEach(b=>{if(b.status==='booked')myBooked++})
    return{liveNow,open,myBooked,total:allClasses.length}
  },[allClasses,bookingMap])

  /* ── Mutations ── */
  const createBk = useCreateBooking()
  const cancelBk = useCancelBooking()
  async function handleBook(id:string){
    setBookPending(p=>new Set(p).add(id))
    try{await createBk.mutateAsync(id);toast.success('Seat reserved! Join link emailed 5 min before class.');setOpenKey(null)}
    catch(e:any){
      const code=e?.response?.data?.error?.code
      if(code==='CONTACT_ADMIN')   setShowAdmin(true)
      else if(code==='SESSION_FULL')    toast.error('Slot is full.')
      else if(code==='ALREADY_BOOKED')  toast.info('Already booked.')
      else if(code==='NOT_ENROLLED')    toast.error('Enroll in this course to book.')
      else if(code==='MODULE_BLOCKED')   toast.error('This class belongs to a module you don\'t have access to. Contact your admin.')
      else if(code==='PENDING_APPROVAL') toast.error('Complete your registration first to book classes.')
      else if(code==='ACCESS_REJECTED')  toast.error('Your access request was not approved. Contact support to appeal.')
      else toast.error(e?.response?.data?.error?.message??'Could not book.')
    }finally{setBookPending(p=>{const s=new Set(p);s.delete(id);return s})}
  }
  async function handleCancel(id:string,label:string){
    setCancelPend(p=>new Set(p).add(id))
    try{await cancelBk.mutateAsync(id);toast.success(`Reservation for ${label} cancelled.`)}
    catch(e:any){toast.error(e?.response?.data?.error?.message??'Could not cancel.')}
    finally{setCancelPend(p=>{const s=new Set(p);s.delete(id);return s})}
  }

  /* ── Helpers ── */
  const isCurrWeek = isSameDay(rangeStart,getMondayOfWeek(new Date()))&&isSameDay(rangeEnd,addDays(getMondayOfWeek(new Date()),6))
  function shiftRange(dir:1|-1){
    const span=Math.round((rangeEnd.getTime()-rangeStart.getTime())/86_400_000)+1
    setRangeStart(addDays(rangeStart,dir*span));setRangeEnd(addDays(rangeEnd,dir*span))
  }
  function toggleDelivery(mode:'online'|'offline'){
    setFilterDelivery(v=>v===mode?'all':mode)
  }

  const panelFilterCount = [
    filterAccess!=='all', filterProgram!=='all', filterCourse!=='all', filterInstructor!=='all',
  ].filter(Boolean).length

  const hasAnyFilter = !!(search||filterAccess!=='all'||filterDelivery!=='all'||filterProgram!=='all'||filterCourse!=='all'||filterInstructor!=='all'||filterLanguage!=='all'||filterStatus!=='all')
  const clearAll = ()=>{setSearch('');setFilterStatus('all');setFilterAccess('all');setFilterDelivery('all');setFilterProgram('all');setFilterCourse('all');setFilterInstructor('all');setFilterLanguage('all')}
  const clearPanel = ()=>{setFilterAccess('all');setFilterProgram('all');setFilterCourse('all');setFilterInstructor('all');setFilterLanguage('all')}
  /* The catalogue hides the chrome that only makes sense over a dated list —
     the week shifter, the status tabs, the metric tiles and the panel filters
     whose axes (course, programme) the tree navigates by instead. Search
     stays: it is the one control the reference product keeps at every level. */
  const isTree = view==='courses'

  const isLoading = loadCls||loadBk

  /* ── Status tab config ── */
  const isOfflineMode = filterDelivery==='offline'
  const liveTabLabel  = isOfflineMode ? 'Today' : 'Live Now'
  const liveTabIcon   = isOfflineMode
    ? <CalendarDays size={11} className="mr-1 flex-shrink-0" style={{color:'currentColor'}}/>
    : statusCounts.live>0
      ? <motion.span animate={{opacity:[1,0.3,1]}} transition={{duration:1.5,repeat:Infinity}} className="h-1.5 w-1.5 rounded-full inline-block mr-1 flex-shrink-0" style={{background: 'var(--color-danger)'}}/>
      : <span className="h-1.5 w-1.5 rounded-full inline-block mr-1 flex-shrink-0" style={{background: 'var(--color-danger)'}}/>

  const STATUS_TABS = [
    {key:'live'     as StatusFilter, label:liveTabLabel, icon:liveTabIcon, color: 'var(--color-danger)', activeStyle:{background:'rgba(239,68,68,0.10)',color: 'var(--color-danger)',border:'1.5px solid rgba(239,68,68,0.28)'}},
    {key:'upcoming' as StatusFilter, label:'Upcoming',   icon:<CalendarDays size={11} className="mr-1 flex-shrink-0"/>, color: 'var(--color-primary)', activeStyle:{background:'rgba(0,87,184,0.10)',color: '#EA6010',border:'1.5px solid rgba(0,87,184,0.28)'}},
    {key:'ended'    as StatusFilter, label:'Completed',  icon:<CheckCircle2 size={11} className="mr-1 flex-shrink-0" strokeWidth={3}/>, color: '#6366F1', activeStyle:{background:'rgba(99,102,241,0.10)',color: '#6366F1',border:'1.5px solid rgba(99,102,241,0.28)'}},
  ]

  return(
    <>
      <FontLoader/>
      <div className="dm mx-auto max-w-5xl pb-20">

        {/* ─── HERO ─────────────────────────────────────────────── */}
        <motion.div initial={{opacity:0,y:-12}} animate={{opacity:1,y:0}}
          transition={{type:'spring',stiffness:280,damping:26}} className="mb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg"
                  style={{background: 'var(--color-primary)',boxShadow:'0 3px 10px rgba(0,87,184,0.30)'}}>
                  <CalendarDays size={12} color="white"/>
                </div>
                <span className="dm text-[11px] sm:text-[10px] font-bold uppercase tracking-widest" style={{color: 'var(--color-primary)'}}>Class Schedule</span>
              </div>
              <h1 className="syne text-[26px] font-800 leading-none tracking-tight" style={{color: 'var(--color-text-primary)'}}>
                {isTree?'Browse Courses':filterStatus==='all'?fmtDateRange(rangeStart,rangeEnd):filterStatus==='live'?(isOfflineMode?"Today's Classes":'Live Now'):filterStatus==='upcoming'?'Upcoming Sessions':'Completed Sessions'}
              </h1>
              <p className="dm mt-1 text-[11px]" style={{color: 'var(--color-text-secondary)'}}>
                Times are shown in your local time ({APP_TIMEZONE.replace(/_/g, ' ')})
              </p>
            </div>

            {/* Date nav — only shown for 'all' status view, and never in the
                tree: the catalogue spans every upcoming week by design, so a
                Mon-Sun shifter there would promise a filter it does not apply. */}
            {!isTree&&filterStatus==='all'&&(
              <div className="relative flex items-center gap-2" ref={calRef}>
                {!isCurrWeek&&(
                  <button type="button"
                    onClick={()=>{const m=getMondayOfWeek(new Date());setRangeStart(m);setRangeEnd(addDays(m,6))}}
                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold"
                    style={{background:'rgba(0,87,184,0.10)',color: 'var(--color-primary)',border:'1px solid rgba(0,87,184,0.22)'}}>
                    ← Today
                  </button>
                )}
                <div className="flex items-center gap-0.5 rounded-2xl bg-[var(--color-bg-surface)] p-1"
                  style={{border: '1px solid var(--color-border)',boxShadow:'0 1px 4px rgba(15,23,42,0.05)'}}>
                  <button type="button" onClick={()=>shiftRange(-1)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-[var(--color-bg-muted)] sm:h-7 sm:w-7">
                    <ChevronLeft size={13} style={{color: 'var(--color-text-secondary)'}}/>
                  </button>
                  <button type="button" onClick={()=>setShowCal(v=>!v)}
                    className="flex h-11 items-center gap-1.5 rounded-xl px-2 hover:bg-[var(--color-bg-muted)] sm:h-auto sm:py-1">
                    <Calendar size={11} style={{color:showCal?'#0057b8':'var(--color-text-muted)'}}/>
                    <span className="dm whitespace-nowrap text-[11px] font-semibold" style={{color: 'var(--color-text-secondary)'}}>
                      {rangeStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} to {rangeEnd.toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                    </span>
                  </button>
                  <button type="button" onClick={()=>shiftRange(1)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-[var(--color-bg-muted)] sm:h-7 sm:w-7">
                    <ChevronRight size={13} style={{color: 'var(--color-text-secondary)'}}/>
                  </button>
                </div>
                <AnimatePresence>
                  {showCal&&<MiniCalendar rangeStart={rangeStart} rangeEnd={rangeEnd}
                    onRangeChange={(s,e)=>{setRangeStart(s);setRangeEnd(e)}} onClose={()=>setShowCal(false)}/>}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.div>

        {/* ─── STATS ────────────────────────────────────────────── */}
        {!isTree&&!isLoading&&filterDelivery!=='offline'&&(
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile index={0} icon={<CalendarDays size={18} strokeWidth={1.75}/>} label="Total Classes"   value={stats.total}    accent="var(--color-text-secondary)" />
            <MetricTile index={1} icon={<Flame size={18} strokeWidth={1.75}/>}        label="Live Now"        value={stats.liveNow}  accent="#EF4444" pulse={stats.liveNow>0} />
            <MetricTile index={2} icon={<CheckCircle2 size={18} strokeWidth={1.75}/>} label="My Reservations" value={stats.myBooked} accent="#059669" />
            <MetricTile index={3} icon={<TrendingUp size={18} strokeWidth={1.75}/>}   label="Open Slots"      value={stats.open}     accent="#0057b8" />
          </div>
        )}

        {/* ─── OFFLINE DASHBOARD ────────────────────────────────── */}
        <AnimatePresence>
          {!isTree&&!isLoading&&filterDelivery==='offline'&&(
            <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}}
              transition={{type:'spring',stiffness:320,damping:28}}
              className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricTile index={0} icon={<CalendarDays size={18} strokeWidth={1.75}/>} label="Total Sessions"   value={offlineStats.total}            accent="var(--color-text-secondary)" />
              <MetricTile index={1} icon={<Flame size={18} strokeWidth={1.75}/>}        label="Today's Classes"  value={offlineStats.today}            accent="#EF4444" pulse={offlineStats.today>0} />
              <MetricTile index={2} icon={<CheckCircle2 size={18} strokeWidth={1.75}/>} label="My Reservations"  value={offlineStats.myReservations}   accent="#059669" />
              <MetricTile index={3} icon={<TrendingUp size={18} strokeWidth={1.75}/>}   label="Available Seats"  value={offlineStats.availableSeats}   accent="#0057b8" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── STATUS TABS ──────────────────────────────────────── */}
        {/* Hidden in the tree: live/upcoming/ended slice a chronological list,
            and the catalogue is not one. Every slot still carries its own
            status chip, which is where that answer belongs there. */}
        {!isTree&&<motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:0.04}}
          className="mb-3 flex items-center gap-2 flex-wrap">
          {/* All tab */}
          <button type="button" onClick={()=>setFilterStatus('all')}
            className="dm inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold transition-all sm:h-auto sm:py-2"
            style={filterStatus==='all'
              ?{background: 'var(--color-text-primary)',color:'var(--color-text-inverse)',border:'1.5px solid transparent',fontWeight:700}
              :{background: 'var(--color-bg-surface)',color: 'var(--color-text-secondary)',border: '1px solid var(--color-border)'}}>
            All
            <span className="rounded-full px-1.5 text-[11px] sm:text-[10px] font-bold"
              style={{background:filterStatus==='all'?'rgba(255,255,255,0.15)':'var(--color-bg-muted)',color:filterStatus==='all'?'white':'var(--color-text-muted)'}}>
              {allClasses.length}
            </span>
          </button>
          {STATUS_TABS.map(tab=>(
            <button key={tab.key} type="button" onClick={()=>setFilterStatus(tab.key)}
              className="dm inline-flex h-11 items-center rounded-full px-4 text-[12px] font-semibold transition-all sm:h-auto sm:py-2"
              style={filterStatus===tab.key
                ?{...tab.activeStyle,fontWeight:700}
                :{background: 'var(--color-bg-surface)',color: 'var(--color-text-secondary)',border: '1px solid var(--color-border)'}}>
              {tab.icon}
              {tab.label}
              {(()=>{const cnt=(isOfflineMode&&tab.key==='live')?statusCounts.today:(statusCounts as Record<string,number>)[tab.key];return cnt>0&&(
                <span className="ml-1.5 rounded-full px-1.5 text-[11px] sm:text-[10px] font-bold"
                  style={{
                    background:filterStatus===tab.key?'rgba(255,255,255,0.20)':'var(--color-bg-subtle)',
                    color:filterStatus===tab.key?'currentColor':'var(--color-text-muted)',
                  }}>
                  {cnt}
                </span>
              )})()}
            </button>
          ))}
        </motion.div>}

        {/* ─── FILTER BAR ───────────────────────────────────────── */}
        <div className="mb-4 relative" ref={panelRef}>
          <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:0.08}}
            /* Wraps instead of squeezing. On one line the search is `flex-1`,
               which at 375px left it 62px wide — narrower than its own
               placeholder, so the one control you type into was the one that
               gave up all its space. With a min-width it drops to its own line
               on a phone and keeps the full ribbon on desktop, so the group
               still reads as a single tool bar either way. */
            className="flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--color-bg-surface)] px-3 py-2.5"
            style={{border: '1px solid var(--color-border)',boxShadow:'0 1px 6px rgba(15,23,42,0.05)'}}>

            {/* Delivery toggles — dated-list controls. In the tree a class's
                delivery shows on the slot itself, and filtering the catalogue
                by it would silently empty modules rather than explain why. */}
            {!isTree&&<>
            <button type="button" onClick={()=>toggleDelivery('online')}
              className="dm flex h-11 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-all sm:h-auto sm:py-1.5"
              style={filterDelivery==='online'
                ?{background:'rgba(99,102,241,0.12)',color: '#6366F1',border:'1.5px solid rgba(99,102,241,0.30)',fontWeight:600}
                :{background: 'var(--color-bg-inset)',color: 'var(--color-text-secondary)',border: '1px solid var(--color-border)'}}>
              <Wifi size={12}/>Online
            </button>
            <button type="button" onClick={()=>toggleDelivery('offline')}
              className="dm flex h-11 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-all sm:h-auto sm:py-1.5"
              style={filterDelivery==='offline'
                ?{background:'rgba(5,150,105,0.10)',color: 'var(--color-success)',border:'1.5px solid rgba(5,150,105,0.28)',fontWeight:600}
                :{background: 'var(--color-bg-inset)',color: 'var(--color-text-secondary)',border: '1px solid var(--color-border)'}}>
              <Building2 size={12}/>In-Person
            </button>

            {/* Separates the delivery toggles from the search — only meaningful
                while they share a line. Once the ribbon wraps on a phone it
                would trail the first row dividing nothing, so it goes. */}
            <div className="hidden h-5 w-px flex-shrink-0 sm:block" style={{background: 'var(--color-border)'}}/>
            </>}

            {/* Search */}
            <div className="relative min-w-[200px] flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{color:search?'#0057b8':'var(--color-text-muted)'}}/>
              <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Search classes, instructors…"
                className="dm h-11 w-full rounded-xl pl-8 pr-7 text-[16px] outline-none sm:h-auto sm:py-1.5 sm:text-[12px]"
                style={{background:search?'rgba(0,87,184,0.04)':'var(--color-bg-inset)',color: 'var(--color-text-secondary)',
                  border:`1px solid ${search?'rgba(0,87,184,0.25)':'var(--color-border)'}`}}/>
              {search&&(
                <button type="button" onClick={()=>setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X size={10} style={{color: 'var(--color-text-muted)'}}/>
                </button>
              )}
            </div>

            {/* Filters button */}
            {!isTree&&<button type="button" onClick={()=>setShowPanel(v=>!v)}
              className="dm flex h-11 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-all sm:h-auto sm:py-1.5"
              style={showPanel||panelFilterCount>0
                ?{background:'rgba(0,87,184,0.10)',color: '#EA6010',border:'1.5px solid rgba(0,87,184,0.30)',fontWeight:600}
                :{background: 'var(--color-bg-inset)',color: 'var(--color-text-secondary)',border: '1px solid var(--color-border)'}}>
              <SlidersHorizontal size={12}/>
              Filters
              {panelFilterCount>0&&(
                <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white flex-shrink-0"
                  style={{background: 'var(--color-primary)'}}>
                  {panelFilterCount}
                </span>
              )}
            </button>}

            {!isTree&&hasAnyFilter&&(
              <button type="button" onClick={clearAll}
                className="dm hidden sm:flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold flex-shrink-0"
                style={{color: 'var(--color-danger)',border:'1px solid rgba(239,68,68,0.18)'}}>
                <X size={10}/>Clear
              </button>
            )}
          </motion.div>

          {/* ─── FILTER PANEL (expandable) ──────────────────────── */}
          <AnimatePresence>
            {!isTree&&showPanel&&(
              <motion.div initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}}
                transition={{type:'spring',stiffness:380,damping:30}}
                className="mt-2 rounded-2xl bg-[var(--color-bg-surface)] overflow-hidden"
                style={{border: '1px solid var(--color-border)',boxShadow:'0 8px 32px rgba(15,23,42,0.10)'}}>
                <div className="p-5 space-y-5">

                  <PanelSection label="Access" icon={<Lock size={11}/>}>
                    <PanelChip active={filterAccess==='all'}  onClick={()=>setFilterAccess('all')}>All Classes</PanelChip>
                    <PanelChip active={filterAccess==='mine'} onClick={()=>setFilterAccess('mine')}>✓ My Courses Only</PanelChip>
                  </PanelSection>

                  <PanelSection label="Program" icon={<GraduationCap size={11}/>}>
                    <PanelChip active={filterProgram==='all'} onClick={()=>setFilterProgram('all')}>All Programs</PanelChip>
                    {(['4x-trading','digital-marketing','ai','jura'] as ProgramFilter[]).map(key=>(
                      <PanelChip key={key} active={filterProgram===key} onClick={()=>setFilterProgram(key)}
                        count={programCounts[key]??0}>
                        {PROGRAM_LABELS[key]}
                      </PanelChip>
                    ))}
                  </PanelSection>


                  <div className="flex items-center justify-between pt-1" style={{borderTop: '1px solid var(--color-border)'}}>
                    <span className="dm text-[11px]" style={{color: 'var(--color-text-muted)'}}>
                      {panelFilterCount>0?`${panelFilterCount} filter${panelFilterCount>1?'s':''} active`:'No filters active'}
                    </span>
                    <div className="flex gap-2">
                      {panelFilterCount>0&&(
                        <button type="button" onClick={clearPanel}
                          className="dm rounded-full px-3 py-1 text-[11px] font-semibold"
                          style={{color: 'var(--color-danger)',border:'1px solid rgba(239,68,68,0.18)'}}>
                          Clear filters
                        </button>
                      )}
                      <button type="button" onClick={()=>setShowPanel(false)}
                        className="dm rounded-full px-3 py-1 text-[11px] font-semibold"
                        style={{background: 'var(--color-text-primary)',color:'var(--color-text-inverse)'}}>
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── PROGRAM-SCOPED DROPDOWNS ─────────────────────────── */}
        {/* Course and instructor pickers. The tree navigates by course, so
            offering it as a filter there would be two ways to say one thing. */}
        <AnimatePresence>
          {!isTree&&filterProgram!=='all'&&(programCourses.length>0||programInstructors.length>0)&&(
            <motion.div
              initial={{opacity:0,y:-8,height:0}} animate={{opacity:1,y:0,height:'auto'}} exit={{opacity:0,y:-6,height:0}}
              transition={{type:'spring',stiffness:360,damping:30}}
              className="overflow-hidden mb-4">
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                {/* Program label pill */}
                <span className="dm flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold"
                  style={{background:'rgba(0,87,184,0.08)',color: '#EA6010',border:'1px solid rgba(0,87,184,0.20)'}}>
                  <GraduationCap size={11}/>{PROGRAM_LABELS[filterProgram]}
                </span>
                <ChevronRight size={12} style={{color: 'var(--color-text-muted)'}}/>
                {/* Course dropdown */}
                {programCourses.length>0&&(
                  <CourseDropdown
                    value={filterCourse}
                    onChange={v=>{setFilterCourse(v)}}
                    options={programCourses.map(c=>({value:c.id,label:c.title.length>32?c.title.slice(0,30)+'…':c.title}))}
                  />
                )}
                {/* Instructor dropdown */}
                {programInstructors.length>0&&(
                  <InstructorFilterSelect
                    value={filterInstructor}
                    onChange={v=>{setFilterInstructor(v)}}
                    instructors={programInstructors}
                  />
                )}
                {/* Language dropdown */}
                <LanguageDropdown
                  value={filterLanguage}
                  onChange={v=>{setFilterLanguage(v)}}
                />
                {/* Reset scoped filters */}
                {(filterCourse!=='all'||filterInstructor!=='all'||filterLanguage!=='all')&&(
                  <button type="button"
                    onClick={()=>{setFilterCourse('all');setFilterInstructor('all');setFilterLanguage('all')}}
                    className="dm flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold"
                    style={{color: 'var(--color-danger)',border:'1px solid rgba(239,68,68,0.18)'}}>
                    <X size={10}/>Reset
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── VIEW TOGGLE ──────────────────────────────────────── */}
        {/* Both views read the same sessions; they differ only in how they are
            arranged. The flat list stays reachable because "what is on this
            week" is a real question the tree answers badly. */}
        <div className="mb-4 inline-flex items-center gap-1 rounded-full p-1"
          role="tablist" aria-label="Schedule layout"
          style={{background: 'var(--color-bg-inset)',border: '1px solid var(--color-border)'}}>
          {([['courses','Courses',<LayoutGrid key="g" size={12} strokeWidth={2.25}/>],
             ['sessions','All sessions',<List key="l" size={12} strokeWidth={2.25}/>]] as const).map(([k,label,icon])=>(
            <button key={k} type="button" role="tab" aria-selected={view===k}
              onClick={()=>switchView(k as 'courses'|'sessions')}
              className="dm inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold transition-all sm:h-auto sm:px-3 sm:py-1.5"
              style={view===k
                ?{background: 'var(--color-bg-surface)',color: 'var(--color-text-primary)',boxShadow:'0 1px 4px rgba(15,23,42,0.10)',fontWeight:700}
                :{background:'transparent',color: 'var(--color-text-muted)'}}>
              {icon}{label}
            </button>
          ))}
        </div>

        {/* ─── CONTENT ──────────────────────────────────────────── */}
        {isLoading&&(
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <motion.div className="h-6 w-6 rounded-full border-2 border-transparent border-t-blue-500"
              animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:'linear'}}/>
            <p className="dm text-sm" style={{color: 'var(--color-text-muted)'}}>Loading schedule…</p>
          </div>
        )}

        {!isLoading&&isTree&&(
          <>
            <Hierarchy
              /* AnimatePresence identifies its child BY KEY — without one it
                 cannot tell Level 1 from Level 2 and has nothing to cross-fade
                 between, so the drill-down snapped. A key on the motion.div
                 inside Hierarchy is invisible from out here. */
              key={`${hCourse ?? ''}:${hModule ?? ''}`}
              classes={allClasses} bookingMap={bookingMap} search={search}
              courseId={hCourse} moduleId={hModule}
              onNavigate={navigate}
              /* The catalogue books on the card now — no modal, no "choose a
                 date" step. What it does NOT own is what a refused booking
                 means: handleBook keeps the seven error codes, and the
                 hierarchy just calls it. SlotModal stays for the flat weekly
                 list, which is still a list of slot groups. */
              onBook={handleBook} onCancel={handleCancel}
              bookPending={bookPending} cancelPending={cancelPend}
            />
          </>
        )}

        {!isLoading&&!isTree&&(
          <AnimatePresence mode="wait">
            <motion.div
              key={`${rangeStart.toISOString()}-${search}-${filterStatus}-${filterAccess}-${filterDelivery}-${filterProgram}-${filterCourse}-${filterInstructor}-${filterLanguage}`}
              initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-8}} transition={{duration:0.13}}>

              {dateSections.length===0?(
                <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}
                  className="flex flex-col items-center gap-4 rounded-3xl bg-[var(--color-bg-surface)] py-20 text-center"
                  style={{border: '1px solid var(--color-border)'}}>
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl"
                    style={{background:'rgba(0,87,184,0.07)',border:'1px solid rgba(0,87,184,0.14)'}}>
                    <Calendar size={26} style={{color: 'var(--color-primary)'}}/>
                  </div>
                  {allClasses.length===0?(
                    <>
                      <p className="syne font-700 text-lg" style={{color: 'var(--color-text-primary)'}}>No classes yet</p>
                      <p className="dm max-w-xs text-sm" style={{color: 'var(--color-text-muted)'}}>Enroll in a course to see live sessions appear here.</p>
                    </>
                  ):filterDelivery==='offline'?(
                    <>
                      <p className="syne font-700 text-lg" style={{color: 'var(--color-text-primary)'}}>No in-person classes found</p>
                      <p className="dm text-sm" style={{color: 'var(--color-text-muted)'}}>No classroom sessions have been scheduled yet. Check back soon.</p>
                    </>
                  ):hasAnyFilter?(
                    <>
                      <p className="syne font-700 text-lg" style={{color: 'var(--color-text-primary)'}}>No classes match</p>
                      <p className="dm text-sm" style={{color: 'var(--color-text-muted)'}}>Try adjusting your filters{filterStatus==='all'?' or date range':''}.</p>
                      <button type="button" onClick={clearAll}
                        className="rounded-full px-4 py-2 text-sm font-semibold"
                        style={{background:'rgba(0,87,184,0.10)',color: 'var(--color-primary)',border:'1px solid rgba(0,87,184,0.20)'}}>
                        Clear all filters
                      </button>
                    </>
                  ):(
                    <>
                      <p className="syne font-700 text-lg" style={{color: 'var(--color-text-primary)'}}>No classes this period</p>
                      <button type="button" onClick={()=>shiftRange(1)}
                        className="flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-semibold sm:min-h-0 sm:py-2"
                        style={{background:'rgba(0,87,184,0.10)',color: 'var(--color-primary)',border:'1px solid rgba(0,87,184,0.20)'}}>
                        <ChevronRight size={14}/>Next period
                      </button>
                    </>
                  )}
                </motion.div>
              ):(
                <div className="space-y-10">
                  {dateSections.map((sec,si)=>(
                    <motion.div key={sec.dateKey} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:si*0.05}}>
                      {/* Date header */}
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex items-center gap-2 rounded-2xl px-3.5 py-2"
                          style={{
                            background:sec.isToday?'rgba(0,87,184,0.08)':'var(--color-bg-surface)',
                            border:`1px solid ${sec.isToday?'rgba(0,87,184,0.22)':'var(--color-border)'}`,
                            boxShadow:sec.isToday?'0 3px 10px rgba(0,87,184,0.10)':'0 1px 3px rgba(15,23,42,0.04)',
                          }}>
                          {sec.isToday&&(
                            <motion.span animate={{opacity:[1,0.4,1]}} transition={{duration:2,repeat:Infinity}}
                              className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{background: 'var(--color-primary)'}}/>
                          )}
                          <span className="syne text-[12px] font-700" style={{color:sec.isToday?'#0057b8':'#475569'}}>
                            {sec.dateLabel}
                          </span>
                          {sec.isToday&&(
                            <span className="dm rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                              style={{background:'rgba(0,87,184,0.14)',color: 'var(--color-primary)'}}>Today</span>
                          )}
                        </div>
                        <div className="h-px flex-1" style={{background: 'var(--color-border)'}}/>
                        <span className="dm text-[11px] sm:text-[10px]" style={{color: 'var(--color-text-muted)'}}>
                          {sec.groups.length} class{sec.groups.length!==1?'es':''}
                        </span>
                      </div>
                      {/* Cards */}
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        {sec.groups.map((group,i)=>(
                          <motion.div key={group.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}
                            transition={{delay:si*0.04+i*0.03}} className="flex">
                            <ClassCard group={group} bookingMap={bookingMap}
                              onClick={()=>setOpenKey({id:group.id,dateKey:sec.dateKey})}/>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {/* ─── MODALS ───────────────────────────────────────────── */}
        <AnimatePresence>
          {openGroup&&(
            <SlotModal key={openKey!.id+':'+openKey!.dateKey} group={openGroup} bookingMap={bookingMap}
              onBook={handleBook} onCancel={handleCancel} bookPending={bookPending} cancelPending={cancelPend}
              onClose={()=>setOpenKey(null)}/>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showAdmin&&<ContactAdminModal onClose={()=>setShowAdmin(false)}/>}
        </AnimatePresence>
      </div>
    </>
  )
}
