import { Types } from 'mongoose'
import {
  SupportTicketModel,
  UserModel,
  type ISupportTicket,
  type SupportTicketStatus,
  type SupportCategory,
} from '@/models/schema.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { UserRepository } from '@/repositories/user.repository.ts'
import { sendSupportTicketRaisedAlert } from '@/services/email.service.ts'
import { sendSupportTicketRaisedWhatsApp } from '@/services/whatsapp.service.ts'
import { toSubAdminProgram } from '@/utils/programVocabulary.ts'
import { logger } from '@/utils/logger.ts'

export interface ProgramStat {
  program: string; label: string; total: number; open: number; pending: number
  resolved: number; closed: number; unread: number; avgResponseHours: number; responded: number
}

export class SupportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'SupportError'
  }
}

type Requester = {
  id:              string
  role:            'student' | 'instructor' | 'admin' | 'super_admin' | 'sub_admin' | 'support'
  categoryScope?:  '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
  organizationId?: string
}

const isStaff = (r: Requester) =>
  r.role === 'admin' || r.role === 'super_admin' || r.role === 'sub_admin' || r.role === 'support'

/* ─── Tenant isolation ─────────────────────────────────
   List predicate for a caller, or null when no scoping applies. Scoping
   follows the RESOLVED org context — for a super_admin that is the topbar
   org switcher (X-Organization-Id → req.user.organizationId), so "Dubai"
   selected shows only Dubai's tickets and "All Orgs" shows everything.
   Strict equality: the boot migration re-homes every ticket to its owner's
   academy, so org-less tickets no longer exist in steady state. */
const orgScope = (r?: Requester): Record<string, unknown> | null => {
  if (!r?.organizationId || !Types.ObjectId.isValid(r.organizationId)) return null
  return { organizationId: new Types.ObjectId(r.organizationId) }
}

/* Automatic acknowledgement appended to every new ticket, so the student
   immediately sees a response in the thread. It is a SYSTEM message: no
   senderId (both UIs label it "Support Team"), and — critically — it must not
   consume the ticket's new/unread state. The ticket stays `open`,
   `adminUnread: true` and `lastSenderRole: 'student'`, so the admin side sees
   the ticket exactly as before this feature existed, and first-response
   metrics only count sender-bearing (human) admin replies. */
const AUTO_REPLY_BODY =
  'Welcome to Student Support. Your concern is currently being reviewed, and ' +
  'you will receive a response shortly. Thank you for your patience.'

/** Upper bound on a free-text search term before it reaches $regex. */
const MAX_SEARCH_LEN = 100
/** Hard ceiling on messages per ticket — keeps the doc well under Mongo's 16 MB limit. */
const MAX_MESSAGES   = 200

const notifSvc = new NotificationService()
const userRepo = new UserRepository()

export class SupportService {
  /* ── Client opens a new ticket ─────────────────────── */
  async create(
    requester: Requester,
    input: { subject: string; category?: SupportCategory; message: string; program?: string },
  ): Promise<ISupportTicket> {
    const ticketData: Record<string, unknown> = {
      userId:         new Types.ObjectId(requester.id),
      subject:        input.subject.trim(),
      category:       input.category ?? 'other',
      program:        input.program ?? undefined,
      status:         'open',
      messages:       [{
        senderId:   new Types.ObjectId(requester.id),
        senderRole: 'student',
        body:       input.message.trim(),
        createdAt:  new Date(),
      }, {
        /* system auto-acknowledgement — no senderId (see AUTO_REPLY_BODY) */
        senderRole: 'admin',
        body:       AUTO_REPLY_BODY,
        createdAt:  new Date(),
      }],
      lastMessageAt:  new Date(),
      lastSenderRole: 'student',
      userUnread:     false,
      adminUnread:    true,
    }
    if (requester.organizationId && Types.ObjectId.isValid(requester.organizationId)) {
      ticketData['organizationId'] = new Types.ObjectId(requester.organizationId)
    }
    const ticket = await SupportTicketModel.create(ticketData)

    /* Fire-and-forget, same reasoning as every other staff-alert path this
       codebase has (mentor no-show escalation, class reminders): a mail/
       WhatsApp outage must never fail the student's own ticket creation. */
    void this.#notifyStaffOfNewTicket(ticket, requester, input.subject.trim(), input.category ?? 'other')
      .catch(err => logger.error({ err, ticketId: ticket.id }, 'support-ticket staff notification failed'))

    return this.populate(ticket.id)
  }

  /* ── Notify the org admin(s), the ticket's programme sub_admin(s), and
     every super_admin that a student needs help ────────────────────────
     "Programme" here is the student's OWN category, not `input.program` —
     the client's ticket form never actually sends that field (confirmed:
     no reference to it anywhere in client/src), so trusting it would notify
     nobody's sub_admin for every real ticket. The student's account already
     carries the ground truth. */
  async #notifyStaffOfNewTicket(
    ticket: ISupportTicket,
    requester: Requester,
    subject: string,
    category: string,
  ): Promise<void> {
    const student = await UserModel.findById(requester.id)
      .select('name email category categories organizationId').lean()
    if (!student) return

    const orgId = requester.organizationId
      ?? (student.organizationId ? String(student.organizationId) : undefined)
    /* EVERY department the student is in, not the first one. A ticket from a
       student of two departments carries no programme (support.controller.ts
       create) and is listed for each department's sub_admin — so each of them
       is told about it, and nobody is told about a ticket they cannot open
       (plan.md §10). */
    const subAdminPrograms = [...new Set([...(student.categories ?? []), student.category]
      .filter(Boolean).map(p => toSubAdminProgram(p as string)).filter(Boolean))] as string[]

    let staff = orgId ? await userRepo.findOrgStaffForProgram(orgId) : []
    if (orgId && Types.ObjectId.isValid(orgId) && subAdminPrograms.length) {
      staff = [...staff, ...(await UserModel.find({
        role: 'sub_admin', organizationId: new Types.ObjectId(orgId), program: { $in: subAdminPrograms }, isActive: true,
      }).lean() as unknown as typeof staff)]
    }
    const superAdmins = await UserModel.find({ role: 'super_admin', isActive: true })
      .select('name email phone').lean()
    /* No de-dupe needed — findOrgStaffForProgram only ever returns
       admin/sub_admin rows, never a super_admin (same guarantee the mentor
       no-show escalation already relies on). */
    const recipients = [...staff, ...superAdmins]

    const studentName = student.name ?? 'A student'
    for (const r of recipients) {
      const recipientId = String((r as { id?: string; _id?: unknown }).id ?? (r as { _id?: unknown })._id)
      if (recipientId === requester.id) continue   // a student is never their own staff recipient

      try {
        await notifSvc.create(recipientId, {
          kind:  'support-ticket-raised',
          title: `New support ticket: ${subject}`,
          body:  `${studentName} needs help — ${category}`,
          link:  '/support',
        })
      } catch (err) {
        logger.error({ err, recipientId, ticketId: ticket.id }, 'in-app support-ticket notification failed')
      }

      if (r.email) {
        try {
          await sendSupportTicketRaisedAlert(r.email, r.name ?? 'there', studentName, subject, category)
        } catch (err) {
          logger.error({ err, recipientId, ticketId: ticket.id }, 'support-ticket email alert failed')
        }
      }

      if (r.phone) {
        try {
          await sendSupportTicketRaisedWhatsApp(r.phone, studentName, subject)
        } catch (err) {
          logger.error({ err, recipientId, ticketId: ticket.id }, 'support-ticket WhatsApp alert failed')
        }
      }
    }
  }

  /* ── Client: list my tickets ───────────────────────── */
  async listForUser(userId: string): Promise<ISupportTicket[]> {
    return SupportTicketModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ lastMessageAt: -1 })
      .populate('userId', 'name email avatarUrl')
      .exec()
  }

  /* ── Admin: list all tickets (scoped by program and org if set) */
  async listAll(filter: { status?: string; search?: string; program?: string } = {}, requester?: Requester): Promise<ISupportTicket[]> {
    const query: Record<string, unknown> = {}
    if (filter.status && filter.status !== 'all') query['status'] = filter.status
    if (filter.search?.trim()) {
      const escaped = filter.search.trim().slice(0, MAX_SEARCH_LEN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query['subject'] = { $regex: escaped, $options: 'i' }
    }
    const scoped = orgScope(requester)
    if (scoped) Object.assign(query, scoped)
    if (requester?.categoryScope) Object.assign(query, await this.#departmentClause(requester.categoryScope, scoped))
    else if (filter.program) query['program'] = filter.program
    return SupportTicketModel
      .find(query)
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .populate('userId', 'name email avatarUrl')
      .exec()
  }

  /* ── Admin: status counts (scoped by program and org if set) ── */
  async adminStats(program?: string, requester?: Requester): Promise<{ open: number; pending: number; resolved: number; closed: number; unread: number; total: number }> {
    const scoped = orgScope(requester)
    const base: Record<string, unknown> = requester?.categoryScope
      ? await this.#departmentClause(requester.categoryScope, scoped)
      : program ? { program } : {}
    if (scoped) Object.assign(base, scoped)
    const [open, pending, resolved, closed, unread, total] = await Promise.all([
      SupportTicketModel.countDocuments({ ...base, status: 'open' }),
      SupportTicketModel.countDocuments({ ...base, status: 'pending' }),
      SupportTicketModel.countDocuments({ ...base, status: 'resolved' }),
      SupportTicketModel.countDocuments({ ...base, status: 'closed' }),
      SupportTicketModel.countDocuments({ ...base, adminUnread: true }),
      SupportTicketModel.countDocuments(base),
    ])
    return { total, open, pending, resolved, closed, unread }
  }

  /* ── View a single ticket (owner or staff) ─────────── */
  async getOne(ticketId: string, requester: Requester): Promise<ISupportTicket> {
    if (!Types.ObjectId.isValid(ticketId)) throw new SupportError('INVALID_ID', 'Invalid ticket id', 400)
    const ticket = await SupportTicketModel.findById(ticketId)
    if (!ticket) throw new SupportError('NOT_FOUND', 'Ticket not found', 404)
    await this.assertAccess(ticket, requester)

    // Clear the unread flag for whoever is viewing
    if (isStaff(requester) && ticket.adminUnread) { ticket.adminUnread = false; await ticket.save() }
    else if (!isStaff(requester) && ticket.userUnread) { ticket.userUnread = false; await ticket.save() }

    return this.populate(ticketId)
  }

  /* ── Add a reply (owner or staff) ──────────────────── */
  async addMessage(ticketId: string, requester: Requester, body: string): Promise<ISupportTicket> {
    if (!Types.ObjectId.isValid(ticketId)) throw new SupportError('INVALID_ID', 'Invalid ticket id', 400)
    const ticket = await SupportTicketModel.findById(ticketId)
    if (!ticket) throw new SupportError('NOT_FOUND', 'Ticket not found', 404)
    await this.assertAccess(ticket, requester)
    if (ticket.status === 'closed') throw new SupportError('TICKET_CLOSED', 'This ticket is closed. Open a new one if you still need help.', 400)
    if (ticket.messages.length >= MAX_MESSAGES) throw new SupportError('TICKET_MESSAGE_LIMIT', `This ticket has reached its ${MAX_MESSAGES}-message limit. Open a new one to continue.`, 400)

    const staff = isStaff(requester)
    ticket.messages.push({
      senderId:   new Types.ObjectId(requester.id),
      senderRole: staff ? 'admin' : 'student',
      body:       body.trim(),
      createdAt:  new Date(),
    })
    ticket.lastMessageAt  = new Date()
    ticket.lastSenderRole = staff ? 'admin' : 'student'
    ticket.status      = staff ? 'pending' : 'open'
    ticket.userUnread  = staff ? true  : ticket.userUnread
    ticket.adminUnread = staff ? false : true
    await ticket.save()

    if (staff) {
      void notifSvc.create(String(ticket.userId), {
        kind:  'system',
        title: `Support replied: ${ticket.subject}`,
        body:  body.trim().slice(0, 140),
        link:  '/support',
      }).catch(err => logger.error({ err }, '[support] reply notification failed'))
    }

    return this.populate(ticketId)
  }

  /* ── Admin: change ticket status ───────────────────── */
  async setStatus(ticketId: string, status: SupportTicketStatus, requester: Requester): Promise<ISupportTicket> {
    if (!Types.ObjectId.isValid(ticketId)) throw new SupportError('INVALID_ID', 'Invalid ticket id', 400)
    const ticket = await SupportTicketModel.findById(ticketId)
    if (!ticket) throw new SupportError('NOT_FOUND', 'Ticket not found', 404)
    await this.assertAccess(ticket, requester)
    ticket.status = status
    await ticket.save()
    return this.populate(ticketId)
  }

  /* ── Admin: per-program performance stats (org-scoped like the list) ── */
  async adminPerformance(requester?: Requester): Promise<ProgramStat[]> {
    const scoped = orgScope(requester) ?? {}
    const programs: { id: string; label: string }[] = [
      { id: 'ai',                 label: 'AI' },
      { id: '4x-trading',        label: 'FOREX' },
      { id: 'jura',              label: 'JURA' },
      { id: 'digital-marketing', label: 'Digital Marketing' },
    ]
    /* A department's sub_admin sees its own department's row only (plan.md §10). */
    const shown = requester?.categoryScope ? programs.filter(p => p.id === requester.categoryScope) : programs
    return Promise.all(shown.map(async prog => {
      const tickets = await SupportTicketModel.find({ program: prog.id, ...scoped }).lean()
      const total    = tickets.length
      const open     = tickets.filter(t => t.status === 'open').length
      const pending  = tickets.filter(t => t.status === 'pending').length
      const resolved = tickets.filter(t => t.status === 'resolved').length
      const closed   = tickets.filter(t => t.status === 'closed').length
      const unread   = tickets.filter(t => t.adminUnread).length
      const times = tickets
        .map(t => {
          /* senderId-bearing only: the automatic welcome reply has none and
             must not count as the team's first response */
          const first = (t.messages as any[]).find((m: any) => m.senderRole === 'admin' && m.senderId)
          if (!first) return null
          return (new Date(first.createdAt).getTime() - new Date(t.createdAt).getTime()) / 3_600_000
        })
        .filter((r): r is number => r !== null)
      const avgResponseHours = times.length
        ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10
        : 0
      return { program: prog.id, label: prog.label, total, open, pending, resolved, closed, unread, avgResponseHours, responded: times.length }
    }))
  }

  /* ── helpers ───────────────────────────────────────── */
  private async assertAccess(ticket: ISupportTicket, requester: Requester): Promise<void> {
    if (!isStaff(requester)) {
      // clients can only view their own tickets
      if (String(ticket.userId) !== requester.id) {
        throw new SupportError('FORBIDDEN', 'You do not have access to this ticket', 403)
      }
      return
    }
    // Staff are confined to their own organization. super_admin opens any
    // ticket regardless of the org switcher — the switcher filters LISTS,
    // it is not an access boundary (matches utils/tenancy.ts rule 1).
    if (
      requester.role !== 'super_admin' &&
      requester.organizationId && ticket.organizationId &&
      String(ticket.organizationId) !== String(requester.organizationId)
    ) {
      throw new SupportError('FORBIDDEN', 'You do not have access to this ticket', 403)
    }
    // category-scoped admins can only see their program's tickets
    if (requester.categoryScope) {
      if (ticket.program && ticket.program !== requester.categoryScope) {
        throw new SupportError('FORBIDDEN', 'You do not have access to this ticket', 403)
      }
      /* A ticket with no programme follows its student (plan.md §10): open to
         the sub_admin of a department the student is in, and to nobody else.
         It used to be open to EVERY sub_admin of the academy, while being
         listed for none of them. */
      if (!ticket.program) {
        const owner = await UserModel.findById(ticket.userId).select('category categories').lean()
        const theirs = [...((owner?.categories as string[] | undefined) ?? []), owner?.category]
        if (!theirs.includes(requester.categoryScope)) {
          throw new SupportError('FORBIDDEN', 'You do not have access to this ticket', 403)
        }
      }
    }
  }

  /* Tickets of a department: filed under it, or filed under no programme by a
     student who belongs to it (a student of two departments). One rule for the
     list, the counts and assertAccess above. */
  async #departmentClause(program: string, scoped: Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const orphanOwners = await SupportTicketModel.distinct('userId', { ...(scoped ?? {}), program: { $in: [null, ''] } })
    const ours = orphanOwners.length
      ? await UserModel.find({ _id: { $in: orphanOwners }, $or: [{ category: program }, { categories: program }] }).distinct('_id')
      : []
    return ours.length
      ? { $or: [{ program }, { program: { $in: [null, ''] }, userId: { $in: ours } }] }
      : { program }
  }

  private async populate(ticketId: string): Promise<ISupportTicket> {
    return SupportTicketModel
      .findById(ticketId)
      .populate('userId', 'name email avatarUrl')
      .populate('messages.senderId', 'name avatarUrl role')
      .exec() as unknown as ISupportTicket
  }
}
