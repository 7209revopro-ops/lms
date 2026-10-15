/* ─────────────────────────────────────────────────────
   featureFlags — switches read once, in one place

   WHY THIS FILE EXISTS RATHER THAN A CONSTANT IN THE SERVICE THAT USES IT.

   CROSS_ORG_CLASSES started life in classEntitlement.service.ts, which was fine
   while only the entitlement resolver consulted it. It is not fine now: the
   DISCOVERY filters in utils/tenancy.ts have to consult the same switch, and a
   utility importing a service to ask a question about an environment variable is
   how an import cycle starts — schema.ts already pulls services in on some
   paths, which is why half the model imports in this codebase are lazy.

   Reading process.env twice in two files would work and is worse: two sources
   of truth for one switch, and the failure mode is the half that gets missed.
   This file is the one source.

   READ ONCE, AT MODULE LOAD. A flag that can change between two reads inside a
   single request is a flag that can let a student past the door and then refuse
   them at the room, which is the one disagreement this feature must never have.
   Tests that need the other value set process.env BEFORE importing anything.
───────────────────────────────────────────────────── */

/* ONE CLASS, TWO ACADEMIES.

   OFF means the feature is completely dark: a guest cohort can be authored on a
   class, and no student of that academy can SEE the class, book it, or enter
   it. Both halves matter. Gating only entitlement produced a class that showed
   up on a guest student's schedule and then refused them at booking — visible
   but unbookable, which is worse than invisible because it generates a support
   ticket instead of silence.

   Turning it on is a deployment decision, and so is turning it off again. That
   is deliberate: backing the feature out in code after guests have booked would
   leave them holding seats they are refused at the door. */
export const CROSS_ORG_CLASSES_ENABLED =
  String(process.env['CROSS_ORG_CLASSES'] ?? '').toLowerCase() === 'true'

/* ── WHICH WHATSAPP TEMPLATES MAY GO OUT AT ALL (2026-10-15) ──────────────
   WhatsApp is billed per message, so only these are sent (the user's list):
     class_has_started_v2       a booked class has started — Join
     class_cancelled_v1         a booked class was cancelled
     class_rescheduled_v1       a booked class moved
     class_link_changed_v1      a booked class's joining link changed
     instructor_review_request_v1  review the mentor after class
   Every other notice still goes by email and in-app; only its WhatsApp is not
   sent. Checked where every WhatsApp is made (whatsapp.service.ts sendTemplate)
   AND where a queued one is delivered, so nothing queued earlier slips out.

   WHATSAPP_TEMPLATES_ON overrides the list: comma-separated names, "all" for
   every template, "none" for no WhatsApp at all. Tests send everything unless
   they set it, so the suites keep asserting on their messages. */
const DEFAULT_WHATSAPP_TEMPLATES_ON = [
  'class_has_started_v2', 'class_cancelled_v1', 'class_rescheduled_v1', 'class_link_changed_v1', 'instructor_review_request_v1',
  /* "name@use" lets a template out for one use only: course_update_v1 as a program's "you've been added" message
     (services/program.service.ts) — program WhatsApps go only from here, never from a CS's own WhatsApp (the
     commission portal, PROGRAM_CS_WHATSAPP). The Send message page's course_update_v1 stays off. */
  'course_update_v1@program',
]
const WHATSAPP_ON: ReadonlySet<string> | 'all' = (() => {
  const raw = (process.env['WHATSAPP_TEMPLATES_ON'] ?? '').trim()
  if (!raw) return process.env['NODE_ENV'] === 'test' ? 'all' : new Set(DEFAULT_WHATSAPP_TEMPLATES_ON)
  if (/^all$/i.test(raw)) return 'all'
  if (/^(none|off)$/i.test(raw)) return new Set<string>()
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean))
})()

export function whatsappTemplateOn(name: string, use?: string): boolean {
  return WHATSAPP_ON === 'all' || WHATSAPP_ON.has(name) || (!!use && WHATSAPP_ON.has(`${name}@${use}`))
}
