/* ─────────────────────────────────────────────────────────────
   Send message — an admin sends a chosen WhatsApp template and/or an email to
   a course's students or a live session's booked students.

   Audience
     · course  — enrolments with status 'active' (optionally one academy, or
                 only students for whom a module is open);
     · session — bookings that are booked / attended.
     Below super admin, only the caller's own academy's students, and only a
     course / class their academy may see.
   Personalising: {name} {course} {class} {day} {time} {when} {mentor} in any
   WhatsApp value or the email subject / body, per student — day and time in
   the student's own academy clock.
   Sending goes through the normal outboxes (retries, Email / WhatsApp Logs),
   in the background after the request answers.
───────────────────────────────────────────────────────────── */
import { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'
import { academyClock } from '@/utils/academyClock.ts'
import { ensureOrgSlugs, orgSlugFor } from '@/utils/orgSlugs.ts'
import { renderWhatsApp, SENDABLE_TEMPLATES, WHATSAPP_TEMPLATES, type SendAudience } from '@/utils/whatsappTemplates.ts'

export class BroadcastError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) { super(message) }
}

export const BROADCAST_MAX_RECIPIENTS = 3000

export interface BroadcastInput {
  audience:   SendAudience
  courseId?:  string
  liveClassId?: string
  /* course audience: one academy only; only students with this module open. */
  organizationId?: string
  sectionId?: string
  whatsapp?:  { template: string; values: string[] }
  email?:     { subject: string; body: string }
}
export interface Caller { id: string; role: string; organizationId?: string | null }

interface Recipient {
  userId: string; name: string; email?: string; phone?: string; orgSlug?: string
}
interface Context {
  courseTitle: string; courseSlug?: string; courseId: string
  liveClassId?: string; classTitle?: string; classStart?: Date; mentor?: string
  recipients: Recipient[]
}

const firstName = (n: string) => (n || '').trim().split(/\s+/)[0] || 'there'

export class BroadcastService {
  /** The templates the page may offer for this audience, with their fields. */
  templatesFor(audience: SendAudience) {
    return SENDABLE_TEMPLATES.filter(t => t.audiences.includes(audience)).map(t => {
      const info = WHATSAPP_TEMPLATES[t.name]!
      return { name: t.name, label: info.label, body: info.body ?? null, params: info.params, defaults: t.defaults, button: t.button ?? null, note: t.note ?? null }
    })
  }

  async #context(input: BroadcastInput, caller: Caller): Promise<Context> {
    const { CourseModel, LiveClassModel, EnrollmentModel, ClassBookingModel, UserModel } = await import('@/models/schema.ts')
    await ensureOrgSlugs().catch(() => {})
    const isSuper = caller.role === 'super_admin'
    const callerOrg = caller.organizationId ? String(caller.organizationId) : null

    let courseId: string, liveClassId: string | undefined, classTitle: string | undefined, classStart: Date | undefined, mentor: string | undefined
    let userIds: Types.ObjectId[] = []
    const blockedBy = new Map<string, Set<string>>()

    if (input.audience === 'session') {
      if (!input.liveClassId || !Types.ObjectId.isValid(input.liveClassId)) throw new BroadcastError('INVALID_CLASS', 'Pick a live session.')
      const live = await LiveClassModel.findById(input.liveClassId).select('title scheduledStart courseId organizationId guestCohorts instructorId').lean() as any
      if (!live) throw new BroadcastError('CLASS_NOT_FOUND', 'That live session does not exist.', 404)
      const serves = isSuper || !callerOrg || String(live.organizationId) === callerOrg
        || (live.guestCohorts ?? []).some((c: any) => String(c.organizationId) === callerOrg)
      if (!serves) throw new BroadcastError('CLASS_NOT_FOUND', 'That live session does not exist.', 404)
      courseId = String(live.courseId); liveClassId = String(live._id); classTitle = live.title; classStart = new Date(live.scheduledStart)
      mentor = live.instructorId ? ((await UserModel.findById(live.instructorId).select('name').lean()) as any)?.name : undefined
      const bookings = await ClassBookingModel.find({ liveClassId: live._id, status: { $in: ['booked', 'attended'] } }).select('userId').lean() as any[]
      userIds = bookings.map(b => b.userId)
    } else {
      if (!input.courseId || !Types.ObjectId.isValid(input.courseId)) throw new BroadcastError('INVALID_COURSE', 'Pick a course.')
      courseId = input.courseId
      const rows = await EnrollmentModel.find({ courseId: new Types.ObjectId(courseId), status: 'active' }).select('userId blockedLessons').lean() as any[]
      for (const r of rows) blockedBy.set(String(r.userId), new Set((r.blockedLessons ?? []).map(String)))
      userIds = rows.map(r => r.userId)
    }

    const course = await CourseModel.findById(courseId).select('title slug organizationId sharedAcademies').lean() as any
    if (!course) throw new BroadcastError('COURSE_NOT_FOUND', 'That course does not exist.', 404)
    if (input.audience === 'course' && !isSuper && callerOrg && String(course.organizationId) !== callerOrg && !course.sharedAcademies) {
      throw new BroadcastError('COURSE_NOT_FOUND', 'That course does not exist.', 404)
    }

    /* Who: active students, the caller's academy below super admin, the
       chosen academy / open module for a course. */
    const filter: Record<string, unknown> = { _id: { $in: userIds }, role: 'student', isActive: { $ne: false } }
    const onlyOrg = !isSuper && callerOrg ? callerOrg : (input.organizationId && Types.ObjectId.isValid(input.organizationId) ? input.organizationId : null)
    if (onlyOrg) filter['organizationId'] = new Types.ObjectId(onlyOrg)
    const users = await UserModel.find(filter).select('name email phone enrollmentApplication.phone organizationId').lean() as any[]
    const sec = input.audience === 'course' && input.sectionId ? String(input.sectionId) : null

    const recipients: Recipient[] = users
      .filter(u => !sec || !blockedBy.get(String(u._id))?.has(sec))
      .map(u => ({
        userId: String(u._id), name: u.name ?? '', email: u.email || undefined,
        phone: u.enrollmentApplication?.phone || u.phone || undefined,
        orgSlug: orgSlugFor(u.organizationId),
      }))
    if (recipients.length > BROADCAST_MAX_RECIPIENTS) {
      throw new BroadcastError('TOO_MANY', `That is ${recipients.length} students — more than ${BROADCAST_MAX_RECIPIENTS} at once. Narrow it to one academy or a module.`)
    }
    return { courseTitle: course.title, courseSlug: course.slug, courseId, liveClassId, classTitle, classStart, mentor, recipients }
  }

  #tokens(ctx: Context, r: Recipient): Record<string, string> {
    const t: Record<string, string> = { name: firstName(r.name), course: ctx.courseTitle, class: ctx.classTitle ?? '', mentor: ctx.mentor ?? '' }
    if (ctx.classStart) {
      const c = academyClock(ctx.classStart, r.orgSlug)
      const day = ctx.classStart.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: c.zone }).replace(/^(\w{3}) /, '$1, ')
      t['day'] = day; t['time'] = c.time; t['when'] = `${day}, ${c.time}`
    } else { t['day'] = ''; t['time'] = ''; t['when'] = '' }
    return t
  }
  #fill = (s: string, t: Record<string, string>) => s.replace(/\{(name|course|class|day|time|when|mentor)\}/g, (_, k) => t[k] ?? '')

  #validate(input: BroadcastInput) {
    if (!input.whatsapp && !input.email) throw new BroadcastError('NOTHING_TO_SEND', 'Choose WhatsApp, email, or both.')
    if (input.whatsapp) {
      const t = SENDABLE_TEMPLATES.find(x => x.name === input.whatsapp!.template && x.audiences.includes(input.audience))
      if (!t) throw new BroadcastError('INVALID_TEMPLATE', 'That WhatsApp template cannot be sent from here.')
      const n = WHATSAPP_TEMPLATES[t.name]!.params.length
      if (input.whatsapp.values.length !== n || input.whatsapp.values.some(v => !String(v ?? '').trim())) {
        throw new BroadcastError('MISSING_VALUES', `Fill in all ${n} values of the WhatsApp message.`)
      }
    }
    if (input.email && (!input.email.subject.trim() || !input.email.body.trim())) {
      throw new BroadcastError('MISSING_EMAIL', 'The email needs a subject and a message.')
    }
  }

  #nextPath(button: string | undefined, ctx: Context): string {
    if (button === 'signin-class' && ctx.liveClassId) return `/live-classes/${ctx.liveClassId}/watch`
    if (button === 'signin-course') return ctx.courseSlug ? `/courses/${ctx.courseSlug}` : '/my-learning'
    if (button === 'signin-schedule') return '/class-bookings'
    return '/my-bookings'
  }

  async preview(input: BroadcastInput, caller: Caller) {
    this.#validate(input)
    const ctx = await this.#context(input, caller)
    const withPhone = ctx.recipients.filter(r => r.phone).length
    const withEmail = ctx.recipients.filter(r => r.email).length
    const first = ctx.recipients[0]
    let whatsapp: ReturnType<typeof renderWhatsApp> | null = null, email: { subject: string; body: string } | null = null
    if (first) {
      const t = this.#tokens(ctx, first)
      if (input.whatsapp) {
        const tpl = SENDABLE_TEMPLATES.find(x => x.name === input.whatsapp!.template)!
        whatsapp = renderWhatsApp(input.whatsapp.template, input.whatsapp.values.map(v => this.#fill(v, t)), tpl.button ? 'x' : undefined)
      }
      if (input.email) email = { subject: this.#fill(input.email.subject, t), body: this.#fill(input.email.body, t) }
    }
    return {
      total: ctx.recipients.length,
      whatsapp: input.whatsapp ? { willSend: withPhone, noPhone: ctx.recipients.length - withPhone } : null,
      email: input.email ? { willSend: withEmail, noEmail: ctx.recipients.length - withEmail } : null,
      sample: first ? { name: first.name, whatsapp, email } : null,
      names: ctx.recipients.slice(0, 8).map(r => r.name),
      course: ctx.courseTitle, class: ctx.classTitle ?? null,
    }
  }

  /** Queues every message and returns at once; the sending runs behind. */
  async send(input: BroadcastInput, caller: Caller): Promise<{ total: number; whatsapp: number; email: number }> {
    this.#validate(input)
    const ctx = await this.#context(input, caller)
    const wa = input.whatsapp ? ctx.recipients.filter(r => r.phone) : []
    const em = input.email ? ctx.recipients.filter(r => r.email) : []
    void this.#run(input, ctx, wa, em).catch(err => logger.error({ err }, '[Broadcast] send crashed'))
    return { total: ctx.recipients.length, whatsapp: wa.length, email: em.length }
  }

  async #run(input: BroadcastInput, ctx: Context, wa: Recipient[], em: Recipient[]) {
    const { sendTemplateMessage } = await import('@/services/whatsapp.service.ts')
    const { sendAdminMessageEmail } = await import('@/services/email.service.ts')
    const { mintSigninCode } = await import('@/services/signinLink.service.ts')
    const { mintJoinCode } = await import('@/services/joinLink.service.ts')
    const clientUrl = process.env['CLIENT_URL'] ?? ''
    const tpl = input.whatsapp ? SENDABLE_TEMPLATES.find(x => x.name === input.whatsapp!.template)! : null
    let sentWa = 0, sentEm = 0
    for (const r of wa) {
      try {
        const t = this.#tokens(ctx, r)
        let buttonParam: string | undefined
        if (tpl?.button === 'join' && ctx.liveClassId) buttonParam = await mintJoinCode(r.userId, ctx.liveClassId)
        else if (tpl?.button) buttonParam = await mintSigninCode(r.userId, this.#nextPath(tpl.button, ctx))
        await sendTemplateMessage(r.phone, tpl!.name, input.whatsapp!.values.map(v => this.#fill(v, t)), buttonParam)
        sentWa++
      } catch (err) { logger.warn({ err, userId: r.userId }, '[Broadcast] WhatsApp failed') }
    }
    for (const r of em) {
      try {
        const t = this.#tokens(ctx, r)
        const code = await mintSigninCode(r.userId, ctx.liveClassId ? `/live-classes/${ctx.liveClassId}/watch` : this.#nextPath('signin-course', ctx))
        await sendAdminMessageEmail(r.email!, this.#fill(input.email!.subject, t), this.#fill(input.email!.body, t),
          { label: ctx.liveClassId ? 'Open the class' : 'Open the course', url: `${clientUrl}/s/${code}` })
        sentEm++
      } catch (err) { logger.warn({ err, userId: r.userId }, '[Broadcast] email failed') }
    }
    logger.info({ course: ctx.courseId, liveClassId: ctx.liveClassId, whatsapp: sentWa, email: sentEm }, '[Broadcast] done')
  }
}
