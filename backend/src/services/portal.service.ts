import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { UserModel, RoleModel, OrganizationModel } from '@/models/schema.ts'
import { hashPassword } from '@/utils/hash.ts'

/**
 * Answering the Root portal's questions about this server's people.
 *
 * The portal decides who may open what across the estate. It could sign
 * somebody in here and nothing more: the role it recorded was whatever an
 * administrator typed into a box, nothing checked it against this server, and
 * the two could drift apart indefinitely.
 *
 * Two things about this application shape what follows.
 *
 * A person's role here is the enum on their account — student, instructor,
 * admin and so on. There is also a Role collection, but that is a permission
 * *narrowing* applied through customRoleId on top of the base role, and
 * leaving it unset means unrestricted within that role rather than no access.
 * Offering both through one field would make "set their role" mean two
 * different things depending on which was picked, so only the base roles are
 * offered. Custom roles stay where they are managed, in this application.
 *
 * And this server holds more than one organization — Dubai and Bangalore —
 * so every question about a person is asked about one of them.
 */

/**
 * Refusals from here, shaped the way this application shapes them.
 *
 * A plain Error with a statusCode property looks right and is not: the error
 * middleware matches on class, so everything fell through to INTERNAL_ERROR
 * and "belongs to a different organization" was reported as a server fault.
 */
export class PortalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'PortalError'
  }
}

const httpError = (message: string, statusCode: number) => {
  const code =
    statusCode === 404 ? 'NOT_FOUND' :
    statusCode === 409 ? 'CONFLICT' :
    statusCode === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR'
  return new PortalError(code, message, statusCode)
}

/**
 * The roles somebody can be given here, described rather than enumerated.
 *
 * These are not rows in a table: they are the values the account's `role`
 * field may take, and what each one means lives in this application's code.
 * The portal shows the description beside the name so that choosing one is a
 * decision about what somebody will be able to do.
 */
const BASE_ROLES: { key: string; description: string }[] = [
  { key: 'student',     description: 'Takes courses. Cannot open the admin portal.' },
  { key: 'instructor',  description: 'Teaches and manages their own courses.' },
  { key: 'support',     description: 'Helps learners; no course authoring.' },
  { key: 'sub_admin',   description: 'Administers within the limits of an assigned custom role.' },
  { key: 'admin',       description: 'Administers this organization.' },
  { key: 'super_admin', description: 'Everything, everywhere. Bypasses every permission check.' },
]

/** Which organization, insisted upon rather than assumed. */
async function resolveOrg(remoteOrgId?: string) {
  if (!remoteOrgId) {
    throw httpError(
      'This server holds more than one organization, so the portal must say which — set LMS_REMOTE_ORG_ID on its side.',
      400,
    )
  }
  if (!mongoose.isValidObjectId(remoteOrgId)) {
    throw httpError(`"${remoteOrgId}" is not a valid organization id`, 400)
  }
  const org = await OrganizationModel.findById(remoteOrgId).select('name slug')
  if (!org) throw httpError('No such organization on this server', 404)
  return org
}

export interface PortalRole {
  key: string
  name: string
  description: string
  permissions: string[]
  isSystem: boolean
}

/**
 * The roles this server offers.
 *
 * Not scoped to an organization, because they are not: the enum is the same
 * everywhere on this server. Asking for an organization here would add a way
 * to fail for no gain.
 */
export function listRolesForPortal(): { organization: string; roles: PortalRole[] } {
  return {
    organization: 'Delta LMS',
    roles: BASE_ROLES.map((r) => ({
      key: r.key,
      // Underscores are how the value is stored, not how anybody says it.
      name: r.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: r.description,
      permissions: [],
      isSystem: true,
    })),
  }
}

export interface PortalUserState {
  exists: boolean
  inOrganization: boolean
  name: string
  email: string
  status: string
  membershipStatus: string | null
  roleKey: string | null
  roleName: string | null
  permissions: string[]
  lastLoginAt: string | null
}

/**
 * What an account actually holds here, right now.
 *
 * "Does not exist" is an answer rather than an error: the portal asks this
 * about everybody it knows, and most will have no account here.
 *
 * Somebody may exist on this server and belong to the other organization.
 * That is reported rather than hidden — it is the more interesting finding,
 * and calling it "no account" would invite creating a second one.
 */
export async function describeUserForPortal(input: {
  email: string
  remoteOrgId?: string
}): Promise<PortalUserState> {
  const org = await resolveOrg(input.remoteOrgId)
  const email = input.email.toLowerCase().trim()
  if (!email) throw httpError('email is required', 400)

  const blank: PortalUserState = {
    exists: false, inOrganization: false, name: '', email, status: '',
    membershipStatus: null, roleKey: null, roleName: null, permissions: [], lastLoginAt: null,
  }

  const user = await UserModel.findOne({ email }).lean()
  if (!user) return blank

  const here = String(user.organizationId ?? '') === String(org._id)
  const status = user.isActive === false ? 'inactive' : 'active'

  /* A custom role is a narrowing on top of the base role. It is not settable
     from here, but it is worth reporting: somebody reading the portal should
     see that this account is restricted beyond what its role name implies. */
  let permissions: string[] = []
  if (here && user.customRoleId) {
    const custom = await RoleModel.findById(user.customRoleId).select('name').lean()
    if (custom) permissions = [`limited by the custom role "${custom.name}"`]
  }

  return {
    exists: true,
    inOrganization: here,
    name: user.name ?? '',
    email: user.email,
    status,
    membershipStatus: here ? status : null,
    roleKey: here ? user.role ?? null : null,
    roleName: here ? (user.role ?? '').replace(/_/g, ' ') : null,
    permissions,
    lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
  }
}

/** The role, matched the way a person would write it. */
function findRole(name: string): string {
  const wanted = name.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const hit = BASE_ROLES.find((r) => r.key === wanted)
  if (hit) return hit.key
  throw httpError(
    `No role "${name.trim()}" here. Available: ${BASE_ROLES.map((r) => r.key).join(', ')}.`,
    400,
  )
}

/**
 * Change what somebody is here, because the portal said so.
 *
 * Only within the organization named, and creates nothing: provisioning is
 * its own call, and an edit that created accounts as a side effect would turn
 * a typo in an email address into a second person.
 */
export async function setUserRoleFromPortal(input: {
  email: string
  role?: string
  status?: string
  remoteOrgId?: string
}): Promise<{ detail: string; roleKey: string; membershipStatus: string }> {
  const org = await resolveOrg(input.remoteOrgId)
  const email = input.email.toLowerCase().trim()
  if (!email) throw httpError('email is required', 400)
  if (!input.role && !input.status) {
    throw httpError('Nothing to change: give a role, a status, or both', 400)
  }

  const user = await UserModel.findOne({ email })
  if (!user) throw httpError(`${email} has no account on this server — create one first`, 404)
  if (String(user.organizationId ?? '') !== String(org._id)) {
    throw httpError(`${email} belongs to a different organization on this server`, 409)
  }

  const changes: string[] = []

  if (input.role) {
    const role = findRole(input.role)
    if (user.role !== role) {
      /* Only an instructor may be lent to the other academy, and the schema
         enforces it on save — so moving somebody off instructor has to let go
         of that first, or the change is refused with a message about a flag
         nobody set from here. */
      if (user.sharedAcrossOrgs && role !== 'instructor') user.sharedAcrossOrgs = false
      user.role = role as typeof user.role
      changes.push(`role to ${role}`)
    }
  }

  if (input.status) {
    const status = input.status.trim().toLowerCase()
    if (status !== 'active' && status !== 'inactive') {
      throw httpError(`"${status}" is not a status here`, 400)
    }
    const wanted = status === 'active'
    if (user.isActive !== wanted) {
      user.isActive = wanted
      changes.push(`status to ${status}`)
    }
  }

  if (changes.length) await user.save()

  return {
    detail: changes.length
      ? `Changed ${email}'s ${changes.join(' and ')} in ${org.name}`
      : `${email} already held that in ${org.name}`,
    roleKey: user.role ?? '',
    membershipStatus: user.isActive === false ? 'inactive' : 'active',
  }
}

/**
 * Create an account here, because a root admin asked.
 *
 * Signing in from the portal deliberately refuses an unknown person: this
 * server believes what the portal vouches for, so an account appearing
 * because a token arrived would turn a spoofed portal into an instant
 * account. That refusal stands; this is the other half, decided on purpose.
 *
 * The password is random and nobody is told it, including whoever asked for
 * the account — they arrive through the portal and never type one here.
 */
export async function provisionFromPortal(input: {
  email: string
  name: string
  role: string
  remoteOrgId?: string
}): Promise<{ created: boolean; userId: string; detail: string }> {
  const org = await resolveOrg(input.remoteOrgId)
  const email = input.email.toLowerCase().trim()
  if (!email) throw httpError('email is required', 400)

  const role = findRole(input.role)

  const existing = await UserModel.findOne({ email })
  if (existing) {
    if (String(existing.organizationId ?? '') === String(org._id)) {
      // Idempotent: the portal retries, and an administrator clicking twice
      // should not be an error they have to interpret.
      return {
        created: false,
        userId: String(existing._id),
        detail: `${email} already has an account in ${org.name}`,
      }
    }
    throw httpError(`${email} already exists on this server, in a different organization`, 409)
  }

  const user = await UserModel.create({
    organizationId: org._id,
    name: input.name?.trim() || email.split('@')[0],
    email,
    passwordHash: await hashPassword(crypto.randomBytes(24).toString('hex')),
    role,
    isActive: true,
    /* Verified on purpose: they were vouched for by the portal, and leaving
       them unverified would send them looking for a confirmation email that
       the portal's whole point is to avoid. */
    isVerified: true,
  })

  return {
    created: true,
    userId: String(user._id),
    detail: `Created ${email} in ${org.name} as ${role}`,
  }
}

export interface PortalUserSummary {
  email: string
  exists: boolean
  inOrganization: boolean
  name: string
  status: string
  roleKey: string | null
  roleName: string | null
}

/**
 * At most this many addresses in one question.
 *
 * The portal asks about a page of its user list, which is twenty-five. The cap
 * is far above that so it never has to think about the limit, and low enough
 * that this endpoint cannot become a way to sweep every learner on this server
 * one large request at a time.
 */
const MAX_EMAILS = 500

/**
 * The same question as describeUserForPortal, asked about many people at once.
 *
 * The portal shows a column saying which systems each person actually has an
 * account on, across a page of its user list. Asked one at a time that is
 * twenty-five requests to each system for a single screen, so it is asked once
 * instead.
 *
 * Still scoped to one organization, for the same reason the single lookup is.
 * Somebody who exists on this server but belongs to the other organization is
 * reported as not a member rather than as absent — calling that "no account"
 * would invite creating a second one, in bulk.
 *
 * Permissions are left out, and with them the per-account custom-role lookup:
 * that is a query per person, which is exactly what asking once is meant to
 * avoid. A column showing which systems somebody is on does not use them, and
 * whoever wants them opens that one person, where /user gives the full picture.
 *
 * Every address asked about comes back, including the ones with no account.
 * The portal has to tell "asked, and there is nobody" apart from "never
 * answered" — those mean opposite things on its screen.
 */
export async function describeManyForPortal(input: {
  emails: unknown
  remoteOrgId?: string
}): Promise<{ accounts: PortalUserSummary[] }> {
  const org = await resolveOrg(input.remoteOrgId)

  if (!Array.isArray(input.emails)) {
    throw httpError('emails must be a list of addresses', 400)
  }

  // Normalised and de-duplicated the same way a single lookup is, so that
  // asking about 'A@x.com' and 'a@x.com ' is one question, answered once.
  const wanted: string[] = []
  const seen = new Set<string>()
  for (const raw of input.emails) {
    if (typeof raw !== 'string') continue
    const email = raw.toLowerCase().trim()
    if (!email || seen.has(email)) continue
    seen.add(email)
    wanted.push(email)
  }

  if (wanted.length === 0) return { accounts: [] }
  if (wanted.length > MAX_EMAILS) {
    throw httpError(`At most ${MAX_EMAILS} addresses at a time, and ${wanted.length} were asked for`, 400)
  }

  // One query however many were asked for.
  const users = await UserModel.find({ email: { $in: wanted } }).lean()
  const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]))

  return {
    accounts: wanted.map((email) => {
      const user = byEmail.get(email)
      if (!user) {
        return {
          email, exists: false, inOrganization: false,
          name: '', status: '', roleKey: null, roleName: null,
        }
      }
      const here = String(user.organizationId ?? '') === String(org._id)
      const status = user.isActive === false ? 'inactive' : 'active'
      return {
        email,
        exists: true,
        inOrganization: here,
        name: user.name ?? '',
        status,
        roleKey: here ? user.role ?? null : null,
        roleName: here ? (user.role ?? '').replace(/_/g, ' ') : null,
      }
    }),
  }
}

/**
 * The zone those "HH:MM" slots have always meant.
 *
 * `IAvailabilitySlot` stores start and end as bare strings with nothing
 * recording a zone, so they have only ever been readable as local time in the
 * academy's own — which is this. Said out loud here because the portal shows
 * systems across several zones, and a slot rendered in the wrong one is off by
 * ninety minutes while looking perfectly reasonable.
 *
 * The classes alongside them are real timestamps and carry no such ambiguity,
 * which is exactly why this has to be stated rather than assumed: the two
 * halves of one calendar would otherwise disagree with each other quietly.
 */
const AVAILABILITY_TIMEZONE = 'Asia/Dubai'

/** The widest window this will answer for in one question. */
const MAX_WINDOW_DAYS = 62

export interface PortalMentorClass {
  id: string
  /** Null when the class belongs to another academy — see below. */
  title: string | null
  startsAt: string
  durationMins: number
  status: string
  booked: number
  capacity: number
  /** Whether this class belongs to the academy that asked. */
  mine: boolean
}

export interface PortalMentor {
  id: string
  name: string
  email: string
  /** Lent to this academy rather than belonging to it. */
  shared: boolean
  slots: { dayOfWeek: number; startTime: string; endTime: string }[]
  classes: PortalMentorClass[]
  /* Time booked with this mentor that is not a class. Carried beside the
     classes rather than merged into them: they are different things, and a
     screen that wants to show them differently should not have to guess
     which is which. Leaving them out entirely would be worse — the calendar
     would show somebody free during a meeting. */
  meetings: {
    id: string
    title: string
    kind: string
    startsAt: string
    durationMins: number
    /* Names only in the listing. The calendar needs to say who, not how to
       reach them, and addresses on a screen anybody in the academy can open is
       more than that question asks for. */
    attendeeNames: string[]
  }[]
}

/**
 * Who teaches here, when they are free, and what is already in the diary.
 *
 * Two different things, deliberately both: the recurring slots are the pattern
 * somebody set — "Tuesdays, nine to twelve" — and the classes are what has
 * actually been booked into it. Either alone answers half of "who is free on
 * Thursday", and the half it leaves out is the half that matters.
 *
 * Mentors are the instructors this academy may see: its own, plus the ones
 * lent to it. That is the same rule the LMS applies everywhere else for shared
 * instructors, rather than a second definition invented here.
 *
 * Every class in the window comes back, including ones belonging to the other
 * academy — but those arrive without a title. An hour a mentor is teaching is
 * an hour they are not free, and hiding the class entirely would show them as
 * available and have somebody book over it. Naming it would hand one academy
 * the other's timetable. So the time is shared and the subject is not.
 */
export async function listMentorsForPortal(input: {
  remoteOrgId?: string
  from?: string
  to?: string
}): Promise<{ timezone: string; from: string; to: string; mentors: PortalMentor[] }> {
  const org = await resolveOrg(input.remoteOrgId)

  const from = input.from ? new Date(input.from) : new Date()
  if (Number.isNaN(from.getTime())) throw httpError('from is not a date', 400)

  const to = input.to ? new Date(input.to) : new Date(from.getTime() + 7 * 864e5)
  if (Number.isNaN(to.getTime())) throw httpError('to is not a date', 400)
  if (to <= from) throw httpError('to must be after from', 400)
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 864e5) {
    throw httpError(`At most ${MAX_WINDOW_DAYS} days at a time`, 400)
  }

  const { UserModel, MentorAvailabilityModel } = await import('@/models/schema.ts')
  const { LiveClassModel, MentorMeetingModel } = await import('@/models/schema.ts')

  const mentors = await UserModel.find({
    role: 'instructor',
    $or: [{ organizationId: org._id }, { sharedAcrossOrgs: true }],
  })
    .select('name email organizationId sharedAcrossOrgs')
    .lean()

  if (mentors.length === 0) {
    return { timezone: AVAILABILITY_TIMEZONE, from: from.toISOString(), to: to.toISOString(), mentors: [] }
  }

  const ids = mentors.map((m) => m._id)

  // Both sides fetched once for the whole list rather than per mentor.
  const [availability, classes, meetings] = await Promise.all([
    MentorAvailabilityModel.find({ mentorId: { $in: ids } }).lean(),
    LiveClassModel.find({
      instructorId: { $in: ids },
      scheduledStart: { $gte: from, $lte: to },
    })
      .select('title instructorId scheduledStart durationMins status bookedCount sessionCapacity organizationId')
      .lean(),
    MentorMeetingModel.find({
      mentorId: { $in: ids },
      scheduledStart: { $gte: from, $lte: to },
      cancelledAt: null,
    })
      .select('title kind mentorId scheduledStart durationMins attendees')
      .lean(),
  ])

  const slotsByMentor = new Map(
    availability.map((a) => [String(a.mentorId), a.slots ?? []]),
  )

  const meetingsByMentor = new Map<string, PortalMentor['meetings']>()
  for (const m of meetings) {
    const key = String(m.mentorId)
    const list = meetingsByMentor.get(key) ?? []
    list.push({
      id: String(m._id),
      title: m.title ?? '',
      kind: String(m.kind ?? ''),
      startsAt: new Date(m.scheduledStart).toISOString(),
      durationMins: m.durationMins ?? 0,
      attendeeNames: (m.attendees ?? []).map((a) => a.name).filter(Boolean),
    })
    meetingsByMentor.set(key, list)
  }

  const classesByMentor = new Map<string, PortalMentorClass[]>()
  for (const c of classes) {
    const key = String(c.instructorId)
    const mine = String(c.organizationId ?? '') === String(org._id)
    const list = classesByMentor.get(key) ?? []
    list.push({
      id: String(c._id),
      title: mine ? (c.title ?? '') : null,
      startsAt: new Date(c.scheduledStart).toISOString(),
      durationMins: c.durationMins ?? 0,
      status: String(c.status ?? ''),
      booked: c.bookedCount ?? 0,
      capacity: c.sessionCapacity ?? 0,
      mine,
    })
    classesByMentor.set(key, list)
  }

  return {
    timezone: AVAILABILITY_TIMEZONE,
    from: from.toISOString(),
    to: to.toISOString(),
    mentors: mentors
      .map((m) => ({
        id: String(m._id),
        name: m.name ?? '',
        email: m.email ?? '',
        shared: String(m.organizationId ?? '') !== String(org._id),
        slots: (slotsByMentor.get(String(m._id)) ?? []).map((s) => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
        classes: (classesByMentor.get(String(m._id)) ?? []).sort((a, b) =>
          a.startsAt.localeCompare(b.startsAt),
        ),
        meetings: (meetingsByMentor.get(String(m._id)) ?? []).sort((a, b) =>
          a.startsAt.localeCompare(b.startsAt),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export interface PortalMentorMeeting {
  id: string
  title: string
  kind: 'staff' | 'student' | 'client'
  startsAt: string
  durationMins: number
  attendees: { name: string; email?: string }[]
  meetingUrl: string
  bookedByEmail: string
}

/** Two spans on one calendar, overlapping. */
const overlaps = (aStart: Date, aMins: number, bStart: Date, bMins: number): boolean =>
  aStart.getTime() < bStart.getTime() + bMins * 60_000 &&
  bStart.getTime() < aStart.getTime() + aMins * 60_000

/**
 * Book time with a mentor that is not a class.
 *
 * A staff catch-up, an hour with one student, or an hour sold to an outside
 * client. None of those is a live class: a class is course-bound, students book
 * seats in it, and creating one mails the entire enrolled cohort. Doing this
 * through classes would have put strangers on rosters and told a course full of
 * people about a meeting that has nothing to do with them.
 *
 * Refuses a clash rather than recording one. The portal checks before asking,
 * but between its check and this write somebody else may have booked the same
 * hour — and the only place that can answer honestly is here, immediately
 * before the insert. Classes and other meetings both count: an hour teaching is
 * as taken as an hour meeting.
 *
 * Availability is deliberately NOT enforced. Those weekly slots are a pattern
 * somebody set, not a contract, and a mentor who agreed to a Saturday should
 * not be unbookable because nobody updated a form. The portal warns; this
 * records what was decided.
 */
export async function createMentorMeetingForPortal(input: {
  remoteOrgId?: string
  mentorEmail?: string
  title?: string
  kind?: string
  scheduledStart?: string
  durationMins?: number
  meetingUrl?: string
  attendees?: unknown
  notes?: string
  bookedByEmail?: string
}): Promise<{ meeting: PortalMentorMeeting; mentorEmail: string; linkNote: string | null }> {
  const org = await resolveOrg(input.remoteOrgId)

  const title = String(input.title ?? '').trim()
  if (title.length < 3) throw httpError('A title of at least three characters is required', 400)

  const kind = String(input.kind ?? '')
  if (!['staff', 'student', 'client'].includes(kind)) {
    throw httpError('kind must be staff, student or client', 400)
  }

  /* At least one person, and only the ones actually named. A row somebody
     started and abandoned in the form should not become an attendee with an
     empty name, and an address without a name is nobody. */
  const attendees = (Array.isArray(input.attendees) ? input.attendees : [])
    .map((a) => {
      const row = (a ?? {}) as { name?: unknown; email?: unknown }
      return {
        name: String(row.name ?? '').trim(),
        email: String(row.email ?? '').toLowerCase().trim(),
      }
    })
    .filter((a) => a.name.length > 0)
    .slice(0, 25)

  if (attendees.length === 0) throw httpError('Say who the mentor is meeting', 400)

  const bookedByEmail = String(input.bookedByEmail ?? '').toLowerCase().trim()
  if (!bookedByEmail) throw httpError('bookedByEmail is required', 400)

  const start = new Date(String(input.scheduledStart ?? ''))
  if (Number.isNaN(start.getTime())) throw httpError('scheduledStart is not a date', 400)

  const durationMins = Number(input.durationMins ?? 0)
  if (!Number.isInteger(durationMins) || durationMins < 5 || durationMins > 600) {
    throw httpError('durationMins must be a whole number between 5 and 600', 400)
  }

  const { UserModel, LiveClassModel, MentorMeetingModel } = await import('@/models/schema.ts')

  const wanted = String(input.mentorEmail ?? '').toLowerCase().trim()
  if (!wanted) throw httpError('mentorEmail is required', 400)

  /* The same reach rule the listing uses: this academy's own instructors, plus
     the ones lent to it. Booking somebody another academy cannot even see would
     put an hour in a stranger's diary. */
  const mentor = await UserModel.findOne({
    email: wanted,
    role: 'instructor',
    $or: [{ organizationId: org._id }, { sharedAcrossOrgs: true }],
  }).select('name email').lean()
  if (!mentor) throw httpError('No mentor here with that address', 404)

  const windowStart = new Date(start.getTime() - 12 * 3600e3)
  const windowEnd = new Date(start.getTime() + 12 * 3600e3)

  const [classes, meetings] = await Promise.all([
    LiveClassModel.find({
      instructorId: mentor._id,
      scheduledStart: { $gte: windowStart, $lte: windowEnd },
      status: { $ne: 'cancelled' },
    }).select('title scheduledStart durationMins').lean(),
    MentorMeetingModel.find({
      mentorId: mentor._id,
      scheduledStart: { $gte: windowStart, $lte: windowEnd },
      cancelledAt: null,
    }).select('title scheduledStart durationMins').lean(),
  ])

  for (const c of classes) {
    if (overlaps(start, durationMins, new Date(c.scheduledStart), c.durationMins ?? 0)) {
      throw httpError(`That overlaps a class already booked: ${c.title}`, 409)
    }
  }
  for (const m of meetings) {
    if (overlaps(start, durationMins, new Date(m.scheduledStart), m.durationMins ?? 0)) {
      throw httpError(`That overlaps a meeting already booked: ${m.title}`, 409)
    }
  }

  /* A pasted link is used as given. An empty one is an invitation to make a
     Google Meet — which also puts the event on the mentor's own calendar when
     they are internal, so it shows up where they already look.

     A failure there does not fail the booking. The time is the thing being
     agreed; a link can follow, and losing an agreed hour because a calendar API
     was unhappy would be the wrong trade. */
  let meetingUrl = String(input.meetingUrl ?? '').trim()
  let linkNote: string | null = null
  if (!meetingUrl) {
    try {
      const { createGoogleMeetLink } = await import('@/services/googleMeet.service.ts')
      const made = await createGoogleMeetLink({
        title,
        startISO: start.toISOString(),
        durationMins,
        instructorEmail: mentor.email,
      })
      meetingUrl = made.meetingUrl
    } catch {
      linkNote = 'The meeting is booked, but a joining link could not be created — send one yourself.'
    }
  }

  const created = await MentorMeetingModel.create({
    mentorId: mentor._id,
    organizationId: org._id,
    title,
    kind,
    scheduledStart: start,
    durationMins,
    meetingUrl,
    attendees,
    notes: String(input.notes ?? '').trim(),
    bookedByEmail,
  })

  /* Told, not just recorded. A booking the mentor has to go looking for is a
     booking they will miss, and for an outside client this mail is the only
     thing they will ever get about it.

     Not awaited into the response: the meeting exists either way, and a slow
     mail server should not turn a successful booking into an error that has
     somebody book it a second time. */
  const whenText = `${start.toLocaleString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', timeZone: AVAILABILITY_TIMEZONE, hour12: false,
  })} (${AVAILABILITY_TIMEZONE.replace('_', ' ')})`

  const everyone = attendees.map((a) => a.name).join(', ')

  void (async () => {
    const { sendMentorMeetingInvite } = await import('@/services/email.service.ts')
    const common = { title, whenText, durationMins, meetingUrl, notes: String(input.notes ?? '').trim(), bookedByEmail }

    /* The mentor is told who is coming, as one list. */
    await sendMentorMeetingInvite(mentor.email, mentor.name ?? '', {
      ...common, withWhom: everyone,
    }).catch(() => {})

    /* And everybody with an address gets the same invitation and the same
       link. Each is told they are meeting the mentor rather than being handed
       the guest list — an outside client has no business knowing who else was
       invited, and one of these goes to people outside the company. Sent one
       at a time for the same reason: a single message with everybody in `to`
       would publish their addresses to each other. */
    for (const a of attendees) {
      if (!a.email) continue
      await sendMentorMeetingInvite(a.email, a.name, {
        ...common, withWhom: mentor.name ?? mentor.email,
      }).catch(() => {})
    }
  })()

  return {
    mentorEmail: mentor.email,
    linkNote,
    meeting: {
      id: String(created._id),
      title,
      kind: kind as 'staff' | 'student' | 'client',
      startsAt: start.toISOString(),
      durationMins,
      attendees,
      meetingUrl,
      bookedByEmail,
    },
  }
}
