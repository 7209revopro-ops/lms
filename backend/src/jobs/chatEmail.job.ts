/* ─────────────────────────────────────────────────────
   Chat: "you have a message" emails (2026-10-18)
   ─────────────────────────────────────────────────────
   A chat message gets a bell notification at once (services/chat.service.ts).
   The email waits: only if the reader has still not opened the chat
   CHAT_EMAIL_DELAY_MINS (default 10) after the first unread message of a run
   is one sent — to the mentor for a student's message, to the student for a
   mentor's reply. Someone already chatting live never gets one, and a burst
   of messages is one email, not one per message. Opening the chat cancels it
   (markRead clears the flag).

   Every minute; primary instance only, like every other job here (index.ts).
   Each conversation is claimed by flipping its flag off BEFORE the send, so
   two overlapping ticks can never mail it twice.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { logger } from '@/utils/logger.ts'
import { sendChatMessageEmail } from '@/services/email.service.ts'

export const CHAT_EMAIL_DELAY_MINS = (() => {
  const n = Number(process.env['CHAT_EMAIL_DELAY_MINS'])
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10
})()

const BATCH = 200
let running = false

type Side = 'instructor' | 'student'

/* The send is a parameter so a test can watch it without SMTP. */
export async function flushChatEmails(
  send: typeof sendChatMessageEmail = sendChatMessageEmail,
  now: Date = new Date(),
): Promise<{ sent: number; skipped: number; failed: number }> {
  const { ChatConversationModel, UserModel } = await import('@/models/schema.ts')
  const cutoff = new Date(now.getTime() - CHAT_EMAIL_DELAY_MINS * 60_000)
  const clientUrl = (process.env['CLIENT_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')
  const adminUrl  = (process.env['ADMIN_URL']  ?? 'http://localhost:3001').replace(/\/+$/, '')
  const out = { sent: 0, skipped: 0, failed: 0 }

  for (const side of ['instructor', 'student'] as Side[]) {
    const due = `${side}EmailDue`, since = `${side}UnreadSince`, unread = `${side}Unread`
    for (let i = 0; i < BATCH; i++) {
      /* Claim one: still due, still unread, old enough. */
      const conv = await ChatConversationModel.findOneAndUpdate(
        { [due]: true, [since]: { $lte: cutoff } },
        { $unset: { [due]: 1 } },
        { new: false, sort: { [since]: 1 } },
      ).lean() as any
      if (!conv) break
      if (!(conv[unread] > 0)) { out.skipped++; continue }

      const [reader, writer] = await Promise.all([
        UserModel.findById(side === 'instructor' ? conv.instructorId : conv.studentId).select('name email isActive').lean() as any,
        UserModel.findById(side === 'instructor' ? conv.studentId : conv.instructorId).select('name').lean() as any,
      ])
      if (!reader?.email || reader.isActive === false) { out.skipped++; continue }

      const path = `/messages?c=${String(conv._id)}`
      try {
        await send(reader.email, {
          name: reader.name ?? 'there',
          from: writer?.name ?? (side === 'instructor' ? 'a student' : 'your instructor'),
          preview: conv.lastMessagePreview ?? '',
          unread: conv[unread],
          url: `${side === 'instructor' ? adminUrl : clientUrl}${path}`,
          toMentor: side === 'instructor',
        })
        out.sent++
      } catch (err) {
        out.failed++
        logger.warn({ err, convId: String(conv._id), side }, '[ChatEmail] send failed')
      }
    }
  }
  return out
}

export function startChatEmailJob(): void {
  cron.schedule('* * * * *', async () => {
    if (running) return
    running = true
    try {
      const r = await flushChatEmails()
      if (r.sent || r.failed) logger.info(r, '[ChatEmail] flushed')
    } catch (err) {
      logger.error({ err }, '[ChatEmail] job error')
    } finally {
      running = false
    }
  })
  logger.info({ delayMins: CHAT_EMAIL_DELAY_MINS }, '[ChatEmail] unread-chat email job scheduled')
}
