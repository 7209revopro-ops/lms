import mongoose from 'mongoose'

/* ─────────────────────────────────────────────────────────────
   What is waiting on each mentor, for Tetra Commission's Dashboard (the
   user, 2026-10-28: "the mentors' pending on the dashboard for the chiefs
   and the super admin"). Read only.

   GET /service/mentor-pending[?emails=a,b] — every instructor, or these:
     outcomes    their student meetings over and still waiting for the
                 outcome form (meetingOutcome.service.ts waitingFilter)
     unverified  classes asked to be verified and not verified yet
                 (class verification); overdue once the 9 AM-next-day
                 reminder went out (verifyFinalReminderAt)
     messages    students' chat messages they haven't read (instructorUnread)
   Each with its rows (at most ROWS a mentor), oldest first.
───────────────────────────────────────────────────────────── */

const ROWS = 100
const endOf = (m: { scheduledStart: Date; durationMins?: number }) => new Date(new Date(m.scheduledStart).getTime() + (m.durationMins ?? 0) * 60_000)

export async function mentorPendingForPortal(q: { emails?: unknown }, now = new Date()) {
  const { UserModel, MentorMeetingModel, LiveClassModel, ChatConversationModel } = await import('@/models/schema.ts')
  const emails = typeof q.emails === 'string' && q.emails.trim()
    ? [...new Set(q.emails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean))] : null
  const mentors = await UserModel.find({ role: 'instructor', ...(emails ? { email: { $in: emails } } : { isActive: { $ne: false } }) }, { name: 1, email: 1, isActive: 1 }).lean() as any[]
  const ids = mentors.map(m => m._id as mongoose.Types.ObjectId)
  if (!ids.length) return { generatedAt: now.toISOString(), mentors: [] }

  const [meetings, classes, chats] = await Promise.all([
    MentorMeetingModel.find({ mentorId: { $in: ids }, askOutcome: true, kind: 'student', cancelledAt: null, outcome: null, scheduledStart: { $lte: now } },
      { mentorId: 1, title: 1, scheduledStart: 1, durationMins: 1, attendees: 1, category: 1 }).sort({ scheduledStart: 1 }).lean() as Promise<any[]>,
    LiveClassModel.find({ instructorId: { $in: ids }, verifyRequestedAt: { $exists: true }, verifiedAt: { $exists: false }, status: { $ne: 'cancelled' } },
      { instructorId: 1, title: 1, scheduledStart: 1, verifyRequestedAt: 1, verifyFinalReminderAt: 1 }).sort({ scheduledStart: 1 }).lean() as Promise<any[]>,
    ChatConversationModel.find({ instructorId: { $in: ids }, instructorUnread: { $gt: 0 } },
      { instructorId: 1, studentId: 1, instructorUnread: 1, lastMessageAt: 1, lastMessagePreview: 1 }).populate('studentId', 'name email').sort({ lastMessageAt: 1 }).lean() as Promise<any[]>,
  ])

  const by = <T>(rows: T[], key: (r: T) => unknown) => {
    const m = new Map<string, T[]>()
    for (const r of rows) { const k = String(key(r)); m.set(k, [...(m.get(k) ?? []), r]) }
    return m
  }
  const over = meetings.filter(m => endOf(m).getTime() <= now.getTime())
  const meetingsOf = by(over, m => m.mentorId), classesOf = by(classes, c => c.instructorId), chatsOf = by(chats, c => c.instructorId)

  return {
    generatedAt: now.toISOString(),
    mentors: mentors.map(u => {
      const id = String(u._id)
      const ms = meetingsOf.get(id) ?? [], cs = classesOf.get(id) ?? [], ch = chatsOf.get(id) ?? []
      const overdue = cs.filter(c => c.verifyFinalReminderAt).length
      const messages = ch.reduce((n, c) => n + (Number(c.instructorUnread) || 0), 0)
      return {
        instructorId: id, name: u.name ?? '', email: String(u.email ?? '').toLowerCase(), active: u.isActive !== false,
        counts: { outcomes: ms.length, unverified: cs.length, unverifiedOverdue: overdue, messages, chats: ch.length },
        total: ms.length + cs.length + messages,
        rows: {
          outcomes: ms.slice(0, ROWS).map(m => ({
            id: String(m._id), title: m.title ?? '', startsAt: m.scheduledStart, endsAt: endOf(m), category: String(m.category ?? ''),
            attendees: (m.attendees ?? []).map((a: any) => a?.name || a?.email || '').filter(Boolean),
          })),
          unverified: cs.slice(0, ROWS).map(c => ({
            id: String(c._id), title: c.title ?? '', startsAt: c.scheduledStart, askedAt: c.verifyRequestedAt ?? null, overdue: !!c.verifyFinalReminderAt,
          })),
          messages: ch.slice(0, ROWS).map(c => ({
            id: String(c._id), student: c.studentId?.name ?? '', studentEmail: c.studentId?.email ?? '', unread: Number(c.instructorUnread) || 0,
            lastMessageAt: c.lastMessageAt ?? null, preview: String(c.lastMessagePreview ?? '').slice(0, 140),
          })),
        },
      }
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  }
}
