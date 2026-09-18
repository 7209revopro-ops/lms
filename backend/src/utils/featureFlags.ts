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
