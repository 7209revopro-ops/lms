/* ─────────────────────────────────────────────────────
   meetingIdentity — the name a person wears in the meeting room

   THE MEETING APPLICATION NEVER ASKS ANYONE WHO THEY ARE. It reads the name
   out of the signed ticket the LMS mints (app/api/lms.py sets
   display_name=ticket.name) and its entry page has no name field at all. That
   is the whole reason the join is promptless, and it means the LMS is the sole
   author of every name on every tile — so the rule for what that name IS has to
   live in ONE place.

   It did not. Three call sites each decided for themselves:
     · the host ticket sent email.split('@')[0]           — "basil"
     · the student meet-join sent user.name, else that    — "Basil Mohammed"
     · the student room ticket sent the same again
   Three rules, so an instructor and their own student appeared under different
   naming conventions in the same room, and nothing said which was intended.

   WHY EMAIL IS THE DEFAULT. Display names are not unique and are not verified:
   two students called "Basil M" are indistinguishable on a tile, and a student
   can change their profile name. An email address is unique, is the account
   identifier support and attendance are reconciled against, and is what the
   owner asked for. The cost is real and worth stating: an email on screen is
   visible to every other participant in the room, so a class is a room where
   everyone can read everyone's address.

   The switch exists because that cost is a product decision, not a technical
   one, and it should be changeable without hunting three call sites again.
───────────────────────────────────────────────────── */

export type MeetingNameMode = 'email' | 'name'

/* MEETING_DISPLAY_NAME=name shows the person's LMS display name instead, and
   falls back to the email when they have none. Anything else, including unset,
   is 'email'. */
export const MEETING_NAME_MODE: MeetingNameMode =
  String(process.env['MEETING_DISPLAY_NAME'] ?? '').toLowerCase() === 'name' ? 'name' : 'email'

export interface MeetingPerson {
  name?:  string | null
  email?: string | null
}

/* The label this person carries into the room.

   Never returns an empty string: a blank tile in a live class is worse than an
   ugly one, and the meeting side has no fallback of its own to reach for. */
export function meetingDisplayName(
  person: MeetingPerson,
  /* Shown only when the account has neither an email nor a name, which should
     be impossible — email is required on every account — but a live class is
     not the place to find out. */
  fallback: string = 'Participant',
): string {
  const email = (person.email ?? '').trim()
  const name  = (person.name ?? '').trim()

  if (MEETING_NAME_MODE === 'name') return name || email || fallback
  return email || name || fallback
}
