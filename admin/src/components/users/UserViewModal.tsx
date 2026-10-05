'use client'

import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Mail, Calendar, Shield, Tag, CheckCircle2, XCircle,
  BookOpen, Clock,
} from 'lucide-react'
import type { AdminUser } from '@/lib/api/users'
import { useStudentEnrollments } from '@/lib/api/users'
import Spinner from '@/components/ui/Spinner'
import { AvatarImg } from '@/components/ui/AvatarImg'
import { useBackdropClose } from '@/hooks/useBackdropClose'

const ROLE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  super_admin:             { bg: 'rgba(168,85,247,0.18)',  color: '#A855F7', label: 'Super Admin' },
  admin:                   { bg: 'rgba(251,146,60,0.15)',  color: '#FB923C', label: 'Admin' },
  instructor:              { bg: 'rgba(99,102,241,0.15)',  color: '#818CF8', label: 'Instructor' },
  student:                 { bg: 'rgba(156,163,175,0.15)', color: '#9CA3AF', label: 'Student' },
}

const CATEGORY_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  '4x-trading':        { bg: 'rgba(96,165,250,0.12)',  color: '#60A5FA', label: 'FOREX Trading' },
  'jura':              { bg: 'rgba(139,92,246,0.12)', color: '#8B5CF6', label: 'JURA' },
  'digital-marketing': { bg: 'rgba(52,211,153,0.12)',  color: '#34D399', label: 'Digital Marketing' },
  'ai':                { bg: 'rgba(168,85,247,0.12)',  color: '#C084FC', label: 'AI' },
}

function fmt(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtRelative(d?: string) {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60)   return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30)   return `${days}d ago`
  return fmt(d)
}

interface Props {
  user:    AdminUser
  onClose: () => void
}

export function UserViewModal({ user, onClose }: Props) {
  const backdrop = useBackdropClose(onClose)
  const roleStyle = ROLE_STYLE[user.role] ?? ROLE_STYLE['admin']
  const catStyle  = user.category ? CATEGORY_STYLE[user.category] : null
  const isStudent = user.role === 'student'
  const { data: enrollments, isLoading: enrollmentsLoading } = useStudentEnrollments(isStudent ? user.id : undefined)

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-end"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        {...backdrop}
      >
        <motion.div
          initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          onClick={e => e.stopPropagation()}
          className="flex h-full w-full max-w-sm flex-col shadow-2xl overflow-y-auto"
          style={{ background: '#161829', borderLeft: '1px solid rgba(255,255,255,0.09)' }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 p-6"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-4">
              <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl"
                style={{ background: 'rgba(0,87,184,0.15)', border: '2px solid rgba(0,87,184,0.25)' }}>
                <AvatarImg src={user.avatarUrl}
                  className="h-full w-full object-cover"
                  fallback={<span className="text-2xl font-bold" style={{ color: '#0057b8' }}>{user.name[0]?.toUpperCase()}</span>} />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white truncate" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
                  {user.name}
                </h2>
                <p className="mt-0.5 text-xs truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.email}</p>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: roleStyle.bg, color: roleStyle.color }}>
                    {roleStyle.label}
                  </span>
                  {catStyle && (
                    <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: catStyle.bg, color: catStyle.color }}>
                      {catStyle.label}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                    style={user.isActive
                      ? { background: 'rgba(74,222,128,0.12)', color: '#4ADE80' }
                      : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
                    {user.isActive ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.4)' }}>
              <X size={15} />
            </button>
          </div>

          {/* Details */}
          <div className="flex-1 space-y-5 p-6">
            {/* Info grid */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
                Account Info
              </p>
              {[
                { icon: Mail,          label: 'Email',       value: user.email },
                { icon: Shield,        label: 'Role',        value: roleStyle.label },
                { icon: Tag,           label: 'Category',    value: catStyle?.label ?? '—' },
                { icon: Calendar,      label: 'Joined',      value: fmt(user.createdAt) },
                { icon: Clock,         label: 'Last login',  value: fmtRelative(user.lastLoginAt) },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <Icon size={12} style={{ color: 'rgba(255,255,255,0.4)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</p>
                    <p className="truncate text-sm font-medium text-white">{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Headline/bio */}
            {(user.headline || user.bio) && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                {user.headline && <p className="text-sm font-semibold text-white">{user.headline}</p>}
                {user.bio && <p className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{user.bio}</p>}
              </div>
            )}

            {/* Enrollments (students only) */}
            {isStudent && (
              <div>
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  <BookOpen size={11} className="inline mr-1.5" />Enrolled Courses
                </p>
                {enrollmentsLoading ? (
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    <Spinner size={11} />Loading…
                  </div>
                ) : !enrollments || enrollments.length === 0 ? (
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Not enrolled in any courses yet.</p>
                ) : (
                  <div className="space-y-2">
                    {enrollments.map(e => (
                      <div key={e._id ?? e.id} className="flex items-center gap-3 rounded-xl p-2.5"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <div className="h-8 w-12 flex-shrink-0 overflow-hidden rounded-lg"
                          style={{ background: 'rgba(255,255,255,0.08)' }}>
                          {e.courseId?.thumbnailUrl && (
                            <img src={e.courseId.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-white">{e.courseId?.title ?? '—'}</p>
                          {e.blockedLessons.length > 0 && (
                            <p className="text-[10px]" style={{ color: '#F87171' }}>
                              {e.blockedLessons.length} module{e.blockedLessons.length !== 1 ? 's' : ''} blocked
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
