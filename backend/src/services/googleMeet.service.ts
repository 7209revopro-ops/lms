import { google, type calendar_v3 } from 'googleapis'
import * as fs from 'fs'
import * as path from 'path'

function makeOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw Object.assign(
      new Error(
        'Google Meet is not configured — add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ' +
        'and GOOGLE_REFRESH_TOKEN to your .env file.',
      ),
      { status: 503 },
    )
  }

  const client = new google.auth.OAuth2(clientId, clientSecret)
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

// Uses Domain-Wide Delegation to impersonate a Workspace user when creating Calendar events.
// The service account JSON key must be at backend/google-service-account.json.
function makeServiceAccountAuth(impersonateEmail: string) {
  const keyPath = path.join(process.cwd(), 'google-service-account.json')

  let key: { client_email: string; private_key: string }
  try {
    const raw = fs.readFileSync(keyPath, 'utf-8')
    key = JSON.parse(raw)
  } catch {
    throw Object.assign(
      new Error(
        'google-service-account.json not found in backend/ — ' +
        'download the service account JSON key from Google Cloud and place it there.',
      ),
      { status: 503 },
    )
  }

  return new google.auth.JWT({
    email:   key.client_email,
    key:     key.private_key,
    scopes:  [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      /* Needed to open the room after Calendar creates it. Requesting it here
         is not enough on its own — the SAME scope has to be listed against
         this service account in the Workspace admin console under domain-wide
         delegation, or the JWT comes back without it and the patch 403s. */
      'https://www.googleapis.com/auth/meetings.space.settings',
      /* Creating a space through the Meet API and managing its members
         (co-hosts). Same rule: it must be in the DWD entry too, and since
         Google refuses the WHOLE token when any requested scope is missing,
         a key whose DWD entry lacks it fails every call made with it. */
      'https://www.googleapis.com/auth/meetings.space.created',
    ],
    subject: impersonateEmail,
  })
}

type ServiceAccountAuth = ReturnType<typeof makeServiceAccountAuth>

const MEET_API = 'https://meet.googleapis.com/v2'

/** The Workspace mailbox that owns meetings for instructors outside the
    Workspace domain. Explicit setting first; else the fallback calendar when
    that is a mailbox address (it is in every deployed .env). */
function meetHostMailbox(): string | undefined {
  const explicit = process.env['GOOGLE_MEET_HOST_EMAIL']?.trim()
  if (explicit) return explicit.toLowerCase()
  const cal = process.env['GOOGLE_CALENDAR_ID']?.trim()
  return cal && cal.includes('@') ? cal.toLowerCase() : undefined
}

/** The address a person joins Meet with: their stored Google account when
    they have one, else their login email. */
export function effectiveMeetEmail(user: { email?: string | null; meetEmail?: string | null } | null | undefined): string | undefined {
  const raw = (user?.meetEmail || user?.email || '').trim().toLowerCase()
  return raw || undefined
}

function describeGoogleError(err: any): string {
  const status = err?.response?.status ?? err?.status ?? '?'
  const msg    = err?.response?.data?.error?.message ?? err?.response?.data?.error ?? err?.message ?? 'unknown'
  return `${status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`
}

/* ── Co-hosts ───────────────────────────────────────────────────────────
   Members are added through the REST endpoint directly: the installed
   googleapis client predates spaces.members. Both helpers are best-effort —
   a meeting without a co-host is a degraded class, not a broken one. */
async function addMeetCohost(auth: ServiceAccountAuth, spaceName: string, email: string): Promise<boolean> {
  try {
    await auth.request({ url: `${MEET_API}/${spaceName}/members`, method: 'POST', data: { email, role: 'COHOST' } })
    return true
  } catch (err) {
    console.warn(`[googleMeet] could not make ${email} co-host of ${spaceName}: ${describeGoogleError(err)}`)
    return false
  }
}

async function removeMeetCohost(auth: ServiceAccountAuth, spaceName: string, email: string): Promise<void> {
  try {
    const res = await auth.request<{ members?: Array<{ name: string; email?: string }> }>({
      url: `${MEET_API}/${spaceName}/members`, method: 'GET',
    })
    for (const m of res.data.members ?? []) {
      if (m.email?.toLowerCase() === email.toLowerCase()) {
        await auth.request({ url: `${MEET_API}/${m.name}`, method: 'DELETE' })
      }
    }
  } catch (err) {
    console.warn(`[googleMeet] could not remove co-host ${email} from ${spaceName}: ${describeGoogleError(err)}`)
  }
}

/* ── The staff co-host ───────────────────────────────────────────────────
   One staff Google account co-hosts EVERY app-made class meeting, ahead of
   the instructor — so somebody can always admit, mute or end a room, even
   when the instructor is late or absent. GOOGLE_MEET_STAFF_COHOSTS (comma-
   separated) replaces it; "off" turns it off. Live classes ask for it; mentor
   meetings booked from the Root portal do not.

   A meeting Calendar made (the fallback path, and every class from before
   co-hosted meetings existed) takes no co-hosts through the API — Google
   answers 403 — so those are left for staff to set by hand in Meet. */
const DEFAULT_STAFF_COHOSTS = 'deltatradinguniverse@gmail.com'

export function staffMeetCohosts(): string[] {
  const raw = (process.env['GOOGLE_MEET_STAFF_COHOSTS'] ?? DEFAULT_STAFF_COHOSTS).trim()
  if (/^(off|none)?$/i.test(raw)) return []
  return [...new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+$/.test(s)))]
}

/** Make each address a co-host, in order, skipping any already a member.
    Never throws: what could not be added is reported, not raised. */
export async function ensureMeetCohosts(
  auth: ServiceAccountAuth, spaceName: string, emails: string[],
): Promise<{ added: string[]; present: string[]; failed: string[] }> {
  const out = { added: [] as string[], present: [] as string[], failed: [] as string[] }
  const wanted = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))]
  if (wanted.length === 0) return out

  let members = new Set<string>()
  try {
    const res = await auth.request<{ members?: Array<{ email?: string }> }>({ url: `${MEET_API}/${spaceName}/members`, method: 'GET' })
    members = new Set((res.data.members ?? []).map(m => (m.email ?? '').toLowerCase()).filter(Boolean))
  } catch (err) {
    /* Not knowing who is there is no reason not to try — Google refuses a
       duplicate rather than doubling it. */
    console.warn(`[googleMeet] could not list members of ${spaceName}: ${describeGoogleError(err)}`)
  }

  for (const email of wanted) {
    if (members.has(email)) { out.present.push(email); continue }
    if (await addMeetCohost(auth, spaceName, email)) out.added.push(email)
    else out.failed.push(email)
  }
  return out
}

/** The staff co-host(s) on an existing app-made meeting — what the backfill
    script runs for every upcoming class. Acts as the meeting's owner. */
export async function addStaffCohostsToSpace(space: MeetSpaceRecord, emails = staffMeetCohosts()) {
  return ensureMeetCohosts(makeServiceAccountAuth(space.host), space.name, emails.filter(e => e !== space.host))
}

/* ── Who may walk into the room ──────────────────────────────────────────
   A Meet attached to a Calendar event inherits the host's default access,
   which is TRUSTED: people inside the host's Workspace domain join straight
   in, everybody else has to knock and be let in by the host. Students are all
   "everybody else" — this app invites nobody as a calendar attendee, it just
   emails the link — so every student knocks, and an instructor who is late or
   distracted leaves a queue of people outside a class they paid for.

   OPEN removes the knock for anyone holding the link.

   Two things it does NOT do, and both matter:

     · it does not let ANONYMOUS people in. Someone not signed in to a Google
       account is still held for admission whatever the access type says —
       that is Google's rule, not a setting;
     · it does not keep the link private. OPEN means exactly what it says: a
       forwarded link is a working link, with no knock in the way. For a paid
       course, the knock was the last thing standing between a leaked link and
       a free seat. That is the trade being made here.

   Deliberately NON-FATAL. Setting access needs a scope the refresh token may
   not carry yet, and a class that cannot be created is a worse outcome than a
   class where students knock — so a failure here logs and leaves the meeting
   exactly as Google made it.

   Set GOOGLE_MEET_ACCESS_TYPE=TRUSTED to put the knock back without a code
   change; anything unrecognised is ignored rather than guessed at. */
const MEET_ACCESS_TYPES = ['OPEN', 'TRUSTED', 'RESTRICTED'] as const
type MeetAccessType = typeof MEET_ACCESS_TYPES[number]

function desiredMeetAccess(): MeetAccessType | null {
  const raw = (process.env['GOOGLE_MEET_ACCESS_TYPE'] ?? 'OPEN').trim().toUpperCase()
  if (raw === 'OFF' || raw === 'NONE' || raw === '') return null
  return (MEET_ACCESS_TYPES as readonly string[]).includes(raw)
    ? (raw as MeetAccessType)
    : 'OPEN'
}

/**
 * Opens the meeting space so anyone holding the link joins without knocking.
 *
 * Addressed by MEETING CODE — the Meet API accepts `spaces/{meetingCode}` as
 * well as a space id, which is what makes this reachable at all for a room
 * Calendar created rather than the Meet API.
 *
 * Returns the access type actually applied, or null if nothing was changed.
 */
export async function setMeetAccessType(
  meetingCode: string,
  auth: ReturnType<typeof makeOAuth2Client> | ReturnType<typeof makeServiceAccountAuth>,
): Promise<MeetAccessType | null> {
  const accessType = desiredMeetAccess()
  if (!accessType || !meetingCode) return null

  try {
    const meet = google.meet({ version: 'v2', auth })
    await meet.spaces.patch({
      name:       `spaces/${meetingCode}`,
      updateMask: 'config.accessType',
      requestBody: { config: { accessType } },
    })
    console.info(`[googleMeet] access set to ${accessType} for ${meetingCode}`)
    return accessType
  } catch (err: any) {
    const status = err?.response?.status ?? err?.status
    const msg    = err?.response?.data?.error?.message ?? err?.message ?? 'unknown'
    if (status === 403) {
      /* The single most likely failure, and the only one a person can fix, so
         it gets its own sentence rather than a generic warning. */
      console.warn(
        `[googleMeet] cannot set access for ${meetingCode}: 403. The token lacks ` +
        'https://www.googleapis.com/auth/meetings.space.settings — re-authorise ' +
        'the Google account with that scope (and add it to the service account\'s ' +
        'domain-wide delegation for instructor-hosted classes). The meeting still ' +
        'works; students will be asked to knock.',
      )
    } else {
      console.warn(`[googleMeet] cannot set access for ${meetingCode}: ${status ?? '?'} ${msg}`)
    }
    return null
  }
}

export interface MeetSpaceRecord {
  name:             string
  host:             string
  cohost?:          string
  calendarEventId?: string
}

export interface CreatedMeet {
  meetingUrl:   string
  meetingCode:  string
  accessType:   MeetAccessType | null
  /* The address invited as a calendar guest, or undefined when nobody was —
     the instructor is the organizer (DWD), or has no address on file. */
  invitedEmail?: string
  /* Present only for a Meet-API-created meeting; persisted on the class so
     later edits can keep the co-host and the calendar event in step. */
  meetSpace?:    MeetSpaceRecord
}

/**
 * A meeting the instructor co-hosts, for instructors OUTSIDE the Workspace.
 *
 * Their mailboxes (Zoho-hosted @deltainstitutions.com, or @gmail.com) are not
 * users of any Google Workspace, so no service account can act as them and
 * they cannot be the organizer. The Workspace host mailbox owns the meeting
 * and the instructor is made COHOST — exactly what staff did by hand in Meet
 * settings before this existed.
 *
 * Created through the Meet API, NOT by Calendar: spaces.members only accepts
 * spaces the app itself created (scope meetings.space.created). Measured — on
 * a Calendar-created space members.create answers 403. moderation ON is what
 * turns host management on; chat, reactions and presenting stay unrestricted
 * by default, so students lose nothing.
 *
 * The same meeting is then attached to an event on the host's calendar that
 * invites the instructor, so the class lands on their Google Calendar with the
 * normal Join button. Both that and the co-host step are best-effort: only a
 * failure to create the space itself throws.
 */
type CoHostedMeetingInput = {
  title: string; start: Date; end: Date; host: string; cohostEmail?: string
  /* Staff co-hosts, made co-host FIRST — see staffMeetCohosts. */
  staffCohosts?: string[]
}

async function createCoHostedMeeting(o: CoHostedMeetingInput): Promise<CreatedMeet> {
  return createCoHostedMeetingWith(makeServiceAccountAuth(o.host), o)
}

/* The same, with the owner's auth handed in — what lets the suite drive it
   against a stand-in for Google. */
async function createCoHostedMeetingWith(auth: ServiceAccountAuth, o: CoHostedMeetingInput): Promise<CreatedMeet> {
  const wantAccess = desiredMeetAccess()

  const space = (await auth.request<{
    name: string; meetingUri: string; meetingCode: string; config?: { accessType?: string }
  }>({
    url: `${MEET_API}/spaces`, method: 'POST',
    data: { config: { moderation: 'ON', ...(wantAccess ? { accessType: wantAccess } : {}) } },
  })).data

  /* The host already owns the room — making it its own co-host is meaningless. */
  const invitee = o.cohostEmail && o.cohostEmail !== o.host ? o.cohostEmail : undefined

  /* Staff first, then the instructor. A staff address that IS the instructor
     is added once, as the instructor. */
  const staff = (o.staffCohosts ?? []).filter(s => s !== o.host && s !== invitee)
  if (staff.length) await ensureMeetCohosts(auth, space.name, staff)

  const cohost  = invitee && await addMeetCohost(auth, space.name, invitee) ? invitee : undefined

  let calendarEventId: string | undefined
  try {
    const calendar = google.calendar({ version: 'v3', auth })
    const ev = await calendar.events.insert({
      calendarId: o.host,
      conferenceDataVersion: 1,
      sendUpdates: invitee ? 'all' : 'none',
      requestBody: {
        summary: o.title,
        start:   { dateTime: o.start.toISOString() },
        end:     { dateTime: o.end.toISOString() },
        ...(invitee ? { attendees: [{ email: invitee }] } : {}),
        conferenceData: {
          conferenceId:       space.meetingCode,
          conferenceSolution: { key: { type: 'hangoutsMeet' } },
          entryPoints:        [{ entryPointType: 'video', uri: space.meetingUri }],
        },
      },
    })
    calendarEventId = ev.data.id ?? undefined
  } catch (err) {
    console.warn(`[googleMeet] meeting ${space.meetingCode} created, but its calendar event was not: ${describeGoogleError(err)}`)
  }

  console.info(`[googleMeet] co-hosted meeting ${space.meetingCode} owned by ${o.host}` +
    (staff.length ? `, staff co-host ${staff.join(', ')}` : '') +
    (cohost ? `, co-host ${cohost}` : invitee ? `, co-host ${invitee} NOT applied` : ', no co-host on file'))

  const applied = space.config?.accessType
  return {
    meetingUrl:  space.meetingUri,
    meetingCode: space.meetingCode,
    accessType:  applied && (MEET_ACCESS_TYPES as readonly string[]).includes(applied) ? applied as MeetAccessType : null,
    ...(invitee && calendarEventId ? { invitedEmail: invitee } : {}),
    meetSpace: {
      name: space.name,
      host: o.host,
      ...(cohost          ? { cohost }          : {}),
      ...(calendarEventId ? { calendarEventId } : {}),
    },
  }
}

/**
 * Keep an existing co-hosted meeting in step with its class. Every part is
 * best-effort and logged; returns the co-host and event id that now hold, for
 * the caller to persist.
 *
 *   cohost      undefined = leave as is; null/'' = remove; address = make it so
 *   schedule    the class's CURRENT title/start/duration, when any changed
 *   cancelled   removes the calendar event (Google tells the instructor)
 */
type MeetSpaceChange = {
  cohost?:    string | null
  schedule?:  { title: string; startISO: string; durationMins: number }
  cancelled?: boolean
}

export async function syncMeetSpace(space: MeetSpaceRecord, change: MeetSpaceChange): Promise<{ cohost?: string; calendarEventId?: string }> {
  let auth: ServiceAccountAuth
  try {
    auth = makeServiceAccountAuth(space.host)
  } catch (err) {
    console.warn(`[googleMeet] cannot sync ${space.name}: ${describeGoogleError(err)}`)
    return { cohost: space.cohost, calendarEventId: space.calendarEventId }
  }
  return syncMeetSpaceWith(auth, space, change)
}

/* The same, with the owner's auth handed in — see createCoHostedMeetingWith. */
async function syncMeetSpaceWith(auth: ServiceAccountAuth, space: MeetSpaceRecord, change: MeetSpaceChange): Promise<{ cohost?: string; calendarEventId?: string }> {
  let cohost  = space.cohost
  let invitee: string | null | undefined           // undefined = attendee list untouched
  if (change.cohost !== undefined) {
    const next  = change.cohost?.trim().toLowerCase() || null
    const staff = staffMeetCohosts().filter(s => s !== space.host)
    if (next !== (cohost ?? null)) {
      /* Swapping the instructor never takes the staff co-host out with them —
         when the outgoing "instructor" address is a staff one, it stays. */
      if (cohost && !staff.includes(cohost)) await removeMeetCohost(auth, space.name, cohost)
      const usable = next && next !== space.host ? next : null
      cohost  = usable && (staff.includes(usable) || await addMeetCohost(auth, space.name, usable)) ? usable : undefined
      invitee = usable
    }
    /* And a class edited after this existed picks the staff co-host up too. */
    if (change.cancelled !== true && staff.length) await ensureMeetCohosts(auth, space.name, staff)
  }

  let calendarEventId = space.calendarEventId
  if (calendarEventId) {
    const calendar = google.calendar({ version: 'v3', auth })
    try {
      if (change.cancelled) {
        await calendar.events.delete({ calendarId: space.host, eventId: calendarEventId, sendUpdates: 'all' })
        calendarEventId = undefined
      } else {
        const body: calendar_v3.Schema$Event = {}
        if (change.schedule) {
          const start = new Date(change.schedule.startISO)
          body.summary = change.schedule.title
          body.start   = { dateTime: start.toISOString() }
          body.end     = { dateTime: new Date(start.getTime() + change.schedule.durationMins * 60_000).toISOString() }
        }
        if (invitee !== undefined) body.attendees = invitee ? [{ email: invitee }] : []
        if (Object.keys(body).length > 0) {
          await calendar.events.patch({ calendarId: space.host, eventId: calendarEventId, sendUpdates: 'all', requestBody: body })
        }
      }
    } catch (err) {
      console.warn(`[googleMeet] could not update calendar event ${calendarEventId}: ${describeGoogleError(err)}`)
    }
  }

  return {
    ...(cohost          ? { cohost }          : {}),
    ...(calendarEventId ? { calendarEventId } : {}),
  }
}

/**
 * Creates the Google Meet link for a class and returns it with its meeting code.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID        — OAuth2 Client ID from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET    — OAuth2 Client Secret
 *   GOOGLE_REFRESH_TOKEN    — long-lived refresh token for the fallback mailbox
 *   GOOGLE_CALENDAR_ID      — fallback calendar (default: "primary")
 *   GOOGLE_WORKSPACE_DOMAIN — domain for internal instructor check (default: "deltagroups.ae")
 *   GOOGLE_MEET_HOST_EMAIL  — Workspace mailbox that owns co-hosted meetings
 *                             (default: GOOGLE_CALENDAR_ID when it is an address)
 *
 * Three paths, chosen per instructor:
 *   · Workspace instructor (GOOGLE_WORKSPACE_DOMAIN) — the event is created on their own
 *     calendar via DWD, so they are the organizer and the Meet host.
 *   · Anyone else — the host mailbox owns a Meet-API meeting and the instructor is made
 *     co-host at `instructorMeetEmail` (see createCoHostedMeeting).
 *   · If that fails (or no host mailbox is configured) — the original fallback: an event on
 *     the fallback calendar via OAuth, with the instructor invited as a guest but no co-host.
 */
export async function createGoogleMeetLink(opts: {
  title:                string
  startISO:             string
  durationMins:         number
  instructorEmail?:     string
  instructorMeetEmail?: string
  /* Made co-host ahead of the instructor — live classes pass staffMeetCohosts(). */
  staffCohosts?:        string[]
}): Promise<CreatedMeet> {
  const WORKSPACE_DOMAIN     = process.env.GOOGLE_WORKSPACE_DOMAIN ?? 'deltagroups.ae'
  const instructorIsInternal = opts.instructorEmail?.endsWith(`@${WORKSPACE_DOMAIN}`) ?? false

  if (!instructorIsInternal) {
    const host = meetHostMailbox()
    if (host) {
      const start = new Date(opts.startISO)
      try {
        return await createCoHostedMeeting({
          title:       opts.title,
          start,
          end:         new Date(start.getTime() + opts.durationMins * 60_000),
          host,
          ...(opts.instructorMeetEmail ? { cohostEmail: opts.instructorMeetEmail.trim().toLowerCase() } : {}),
          ...(opts.staffCohosts?.length ? { staffCohosts: opts.staffCohosts } : {}),
        })
      } catch (err) {
        console.warn(`[googleMeet] co-hosted meeting failed, falling back to a calendar meeting without co-host: ${describeGoogleError(err)}`)
      }
    }
  }

  /* Calendar makes the room on the paths below, and a Calendar-made room takes
     no co-hosts through the API (403) — say so, so staff know to add them by hand. */
  if (opts.staffCohosts?.length) {
    console.warn(`[googleMeet] staff co-host ${opts.staffCohosts.join(', ')} NOT applied to "${opts.title}" — ` +
      'a Calendar-made meeting takes no co-hosts through the API; add them in Meet by hand')
  }

  const auth       = instructorIsInternal ? makeServiceAccountAuth(opts.instructorEmail!) : makeOAuth2Client()
  const calendarId = instructorIsInternal
    ? opts.instructorEmail!
    : (process.env.GOOGLE_CALENDAR_ID ?? 'primary')

  if (instructorIsInternal) {
    console.info(`[googleMeet] Creating event on instructor calendar via DWD: ${opts.instructorEmail}`)
  }

  /* Only on the fallback calendar: on the DWD path the instructor already owns
     the event, and inviting the organizer to their own meeting is noise. */
  const invitedEmail = !instructorIsInternal && opts.instructorMeetEmail
    ? opts.instructorMeetEmail.trim().toLowerCase()
    : undefined

  const calendar = google.calendar({ version: 'v3', auth })
  const start    = new Date(opts.startISO)
  const end      = new Date(start.getTime() + opts.durationMins * 60_000)

  let event: calendar_v3.Schema$Event
  try {
    const res = await calendar.events.insert({
      calendarId,
      conferenceDataVersion: 1,
      /* Google emails the invite, which is what puts the class on the
         instructor's own Google Calendar. Students are never guests — they
         get the link from the LMS — so this only ever reaches the instructor. */
      ...(invitedEmail ? { sendUpdates: 'all' } : {}),
      requestBody: {
        summary: opts.title,
        start:   { dateTime: start.toISOString() },
        end:     { dateTime: end.toISOString() },
        ...(invitedEmail ? { attendees: [{ email: invitedEmail }] } : {}),
        conferenceData: {
          createRequest: {
            requestId:             `lms-meet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    })
    event = res.data
  } catch (apiErr: any) {
    const googleMsg: string =
      apiErr?.response?.data?.error?.message ??
      apiErr?.response?.data?.error ??
      apiErr?.message ??
      'Unknown Google API error'
    const status: number = apiErr?.response?.status ?? 502
    console.error('[googleMeet] Calendar API error', status, googleMsg)
    throw Object.assign(
      new Error(`Google Calendar API error (${status}): ${googleMsg}`),
      { status },
    )
  }

  const meetLink = event.conferenceData?.entryPoints?.find(
    ep => ep.entryPointType === 'video',
  )?.uri

  if (!meetLink) {
    throw Object.assign(
      new Error(
        'Google Calendar did not return a Meet link — ensure the Calendar API is enabled ' +
        'in your Cloud project and Google Meet is enabled for the account.',
      ),
      { status: 502 },
    )
  }

  const meetingCode = meetLink.split('/').pop() ?? ''

  /* Reuses the SAME auth the event was created with. The instructor owns a
     room created on their own calendar via DWD, and only the owner may change
     its settings — the support@ token cannot patch a space it does not host. */
  const accessType = await setMeetAccessType(meetingCode, auth)

  return { meetingUrl: meetLink, meetingCode, accessType, ...(invitedEmail ? { invitedEmail } : {}) }
}

/* ── When a Meet meeting started and ended ─────────────
   Google sends no webhook when a meeting ends, so the LMS asks for the
   meeting's conference records (reminders.job.ts runMeetClassEnd). A room
   the LMS made through the Meet API (meetSpace) is read as its host mailbox:
   meetings.space.created, already granted for making it, covers the app's
   own conferences. Any other Meet link is asked by its code with the OAuth
   client the recording poller uses — that account only sees meetings it can. */
export interface MeetConference { startTime: Date; endTime?: Date }

type ConferenceRow = { startTime?: string | null; endTime?: string | null }
const conferencesOf = (rows: ConferenceRow[] | null | undefined): MeetConference[] =>
  (rows ?? []).filter(r => r.startTime).map(r => ({ startTime: new Date(r.startTime!), ...(r.endTime ? { endTime: new Date(r.endTime) } : {}) }))

/**
 * Every conference held in the class's Meet room, as Google records them — [] when there was none (nobody has
 * joined, or the room is one this LMS can't see) — or undefined when Google couldn't be asked: try again later.
 */
export async function fetchMeetConferences(cls: { meetSpace?: MeetSpaceRecord | null; googleMeetCode?: string | null }): Promise<MeetConference[] | undefined> {
  try {
    if (cls.meetSpace?.name && cls.meetSpace.host) {
      const auth = makeServiceAccountAuth(cls.meetSpace.host)
      const filter = encodeURIComponent(`space.name = "${cls.meetSpace.name}"`)
      const res = await auth.request<{ conferenceRecords?: ConferenceRow[] }>({ url: `${MEET_API}/conferenceRecords?filter=${filter}`, method: 'GET' })
      return conferencesOf(res.data.conferenceRecords)
    }
    if (cls.googleMeetCode) {
      const meet = google.meet({ version: 'v2', auth: makeOAuth2Client() })
      const res = await meet.conferenceRecords.list({ filter: `space.meeting_code = "${cls.googleMeetCode}"` })
      return conferencesOf(res.data.conferenceRecords)
    }
    return []
  } catch (err: any) {
    const status = err?.response?.status ?? err?.status
    console.warn(`[googleMeet] fetchMeetConferences: ${status ?? ''} ${err?.message ?? err}`.trim())
    return undefined
  }
}

/**
 * Polls the Google Meet REST API v2 to find the recording for a given meeting code.
 * Returns the Google Drive shareable URL of the first completed recording, or null if not ready.
 * Also automatically sets the Drive file to "anyone with the link can view" so students can watch.
 *
 * Requires the OAuth2 refresh token to have scopes:
 *   https://www.googleapis.com/auth/meetings.space.readonly
 *   https://www.googleapis.com/auth/drive.file  (for sharing the recording)
 */
export async function fetchMeetRecordingUrl(meetingCode: string): Promise<string | null> {
  let oauth2Client: ReturnType<typeof makeOAuth2Client>
  try {
    oauth2Client = makeOAuth2Client()
  } catch {
    return null
  }

  try {
    const meet = google.meet({ version: 'v2', auth: oauth2Client })

    // Find the conference record for this meeting code
    const recordsRes = await meet.conferenceRecords.list({
      filter: `space.meetingCode = "${meetingCode}"`,
    })

    const records = recordsRes.data.conferenceRecords
    if (!records?.length) return null

    // Use the most recent conference record
    const record = records[0]
    if (!record) return null
    const recordName = record.name
    if (!recordName) return null

    // Get recordings for this conference
    const recordingsRes = await meet.conferenceRecords.recordings.list({
      parent: recordName,
    })

    const recordings = recordingsRes.data.recordings
    if (!recordings?.length) return null

    // Find first completed recording with a Drive destination
    for (const rec of recordings) {
      if (rec.state === 'COMPLETED' && rec.driveDestination?.file) {
        const fileId = rec.driveDestination.file.replace('files/', '')

        // Auto-share the Drive file so anyone with the link can view it
        try {
          const drive = google.drive({ version: 'v3', auth: oauth2Client })
          await drive.permissions.create({
            fileId,
            requestBody: { role: 'reader', type: 'anyone' },
          })
        } catch (shareErr: any) {
          // Non-fatal — URL is still usable if sharing fails (admin can share manually)
          console.warn('[googleMeet] Could not auto-share recording:', shareErr?.message)
        }

        // Return a clean shareable Drive link
        return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`
      }
    }

    return null
  } catch (err: any) {
    // 403 = scope not granted; 404 = no conference found yet — both are non-fatal during polling
    const status = err?.response?.status ?? err?.status
    if (status === 403) {
      console.warn(
        '[googleMeet] fetchMeetRecordingUrl: 403 — refresh token lacks meetings.space.readonly scope. ' +
        'Re-authorize with support@deltagroups.ae and add the scope.',
      )
    }
    return null
  }
}

/* For the suite only: the two co-host paths with the owner's auth handed in. */
export const __test = { createCoHostedMeetingWith, syncMeetSpaceWith }
