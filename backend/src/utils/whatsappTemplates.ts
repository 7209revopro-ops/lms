/* ─────────────────────────────────────────────────────────────
   What each WhatsApp template says — for the admin WhatsApp Logs page, which
   shows a sent message the way the student read it.

   `body` is the approved Meta wording where we have it ({{1}}, {{2}} … are
   filled from the row's params); for older templates whose wording lives
   only in Meta, `params` names each value instead. `button` says where the
   button goes. A one-tap sign-in or join code is a live login for that
   student, so it is NEVER shown — only that there is one.
───────────────────────────────────────────────────────────── */
export interface TemplateInfo {
  label:   string
  body?:   string
  params:  string[]
  button?: { base: 'client' | 'admin'; path: string; secret?: string }
}

const STUDENT_NAME = 'Name'
export const WHATSAPP_TEMPLATES: Record<string, TemplateInfo> = {
  new_class_scheduled_v1: { label: 'New class scheduled', params: [STUDENT_NAME, 'Course', 'Class', 'Day', 'Time'],
    body: 'Hi {{1}}, a new class has been scheduled in *{{2}}*:\n\n*{{3}}* — {{4}}, {{5}}\n\nTap the button below to book your seat.',
    button: { base: 'client', path: '/s/', secret: 'one-tap sign-in, 24 h' } },
  todays_classes_v1: { label: "Today's classes", params: [STUDENT_NAME, 'Classes'],
    body: 'Good morning {{1}}! Your classes today:\n\n{{2}}\n\nTap the button below to see your schedule and join on time.',
    button: { base: 'client', path: '/s/', secret: 'one-tap sign-in, 24 h' } },
  class_cancelled_v1: { label: 'Class cancelled', params: [STUDENT_NAME, 'Class', 'Day', 'Time'],
    body: 'Hi {{1}}, your class {{2}} on {{3}} at {{4}} has been cancelled.\n\nTap the button below to book another session.',
    button: { base: 'client', path: '/s/', secret: 'one-tap sign-in, 24 h' } },
  class_rescheduled_v1: { label: 'Class moved', params: [STUDENT_NAME, 'Class', 'Was', 'Now'],
    body: 'Hi {{1}}, your class {{2}} has moved.\n\nWas: {{3}}\nNow: {{4}}\n\nYour booking moves with it. Tap below to see it.',
    button: { base: 'client', path: '/s/', secret: 'one-tap sign-in, 24 h' } },
  class_mentor_changed_v1: { label: 'Mentor changed', params: [STUDENT_NAME, 'Class', 'When', 'New mentor'],
    body: 'Hi {{1}}, your class {{2}} on {{3}} will now be taught by {{4}}.\n\nYour booking stays the same.',
    button: { base: 'client', path: '/s/', secret: 'one-tap sign-in, 24 h' } },
  class_link_changed_v1: { label: 'Joining link changed', params: [STUDENT_NAME, 'Class', 'Day', 'Time'],
    body: 'Hi {{1}}, the joining link for your class {{2}} on {{3}} at {{4}} has changed.\n\nPlease use the button below to join — any old link you saved will no longer work.',
    button: { base: 'client', path: '/s/', secret: 'one-tap sign-in, 24 h' } },
  class_starts_in_5_min_v2: { label: 'Starts in 5 minutes', params: [STUDENT_NAME, 'Class', 'Day', 'Time'],
    body: "Hi {{1}}, your class *{{2}}* starts in 5 minutes ({{3}}, {{4}}).\n\nTap the button below — you'll be signed in and taken straight to the class.",
    button: { base: 'client', path: '/j/', secret: 'one-tap join, 2 h' } },
  class_has_started_v2: { label: 'Class has started', params: [STUDENT_NAME, 'Class'],
    body: "Hi {{1}}, your class *{{2}}* has started.\n\nTap the button below — you'll be signed in and taken straight to the class.",
    button: { base: 'client', path: '/j/', secret: 'one-tap join, 2 h' } },
  course_update_v1: { label: 'Course update', params: [STUDENT_NAME, 'Course', 'Message'],
    body: "Hi {{1}}, there's an update about your course {{2}}:\n\n{{3}}\n\nTap the button below to open your course.",
    button: { base: 'client', path: '/s/', secret: 'one-tap sign-in, 24 h' } },
  class_update_v1: { label: 'Class update', params: [STUDENT_NAME, 'Class', 'When', 'Message'],
    body: "Hi {{1}}, there's an update about your class {{2}} on {{3}}:\n\n{{4}}\n\nTap the button below to open the class.",
    button: { base: 'client', path: '/s/', secret: 'one-tap sign-in, 24 h' } },
  class_starts_in_5_min: { label: 'Starts in 5 minutes (old)', params: [STUDENT_NAME, 'Class', 'Day', 'Time'],
    button: { base: 'client', path: '/live-classes/' } },
  class_has_started: { label: 'Class has started (old)', params: [STUDENT_NAME, 'Class'],
    button: { base: 'client', path: '/live-classes/' } },
  mentor_class_in_10_min: { label: 'Mentor: class in 10 minutes', params: ['Mentor', 'Class', 'Time', 'Booked'],
    button: { base: 'admin', path: '/live-classes/' } },
  booking_confirmed_v2:  { label: 'Booking confirmed', params: [STUDENT_NAME, 'Class', 'Date', 'Time'] },
  class_reminder_tomorrow: { label: 'Reminder: tomorrow', params: ['Class', 'When'] },
  class_starting_soon_v5:  { label: 'Starting soon', params: ['Class', 'Minutes'] },
  class_starting_soon_v4:  { label: 'Starting soon (old)', params: ['Class', 'Minutes'] },
  enrollment_approved:     { label: 'Enrolment approved', params: [STUDENT_NAME, 'Course', 'Sign-in link'] },
  support_ticket_raised_v1: { label: 'Support ticket raised', params: ['Student', 'Subject'] },
  instructor_review_request_v1: { label: 'Mentor review request', params: ['Student', 'Class'] },
}

/** The message as the student read it, its labelled values, and its button. */
export function renderWhatsApp(templateName: string, params: string[], buttonParam?: string): {
  label: string; text?: string; values: Array<{ name: string; value: string }>; button?: string
} {
  const t = WHATSAPP_TEMPLATES[templateName]
  const values = (params ?? []).map((v, i) => ({ name: t?.params[i] ?? `Value ${i + 1}`, value: String(v ?? '') }))
  const text = t?.body?.replace(/\{\{(\d+)\}\}/g, (_, n) => String(params?.[Number(n) - 1] ?? ''))
  let button: string | undefined
  if (t?.button && buttonParam) {
    const base = (t.button.base === 'admin' ? process.env['ADMIN_URL'] : process.env['CLIENT_URL']) ?? ''
    button = t.button.secret ? `${base}${t.button.path}•••• (${t.button.secret})` : `${base}${t.button.path}${buttonParam}`
  }
  return { label: t?.label ?? templateName, ...(text ? { text } : {}), values, ...(button ? { button } : {}) }
}

/* ─────────────────────────────────────────────────────────────
   Templates an admin may send by hand (Send message page), to a course's
   students or a live session's booked students. `defaults` pre-fill each
   value; {name} {course} {class} {day} {time} {when} {mentor} are replaced
   per student. `button` says what the student's own link opens.
───────────────────────────────────────────────────────────── */
export type SendAudience = 'course' | 'session'
export type SendButton = 'signin-course' | 'signin-class' | 'signin-schedule' | 'signin-bookings' | 'join'
export interface SendableTemplate { name: string; audiences: SendAudience[]; defaults: string[]; button?: SendButton; note?: string }

export const SENDABLE_TEMPLATES: SendableTemplate[] = [
  { name: 'course_update_v1',        audiences: ['course'],  defaults: ['{name}', '{course}', ''], button: 'signin-course', note: 'General message about a course — write it in the last value.' },
  { name: 'class_update_v1',         audiences: ['session'], defaults: ['{name}', '{class}', '{when}', ''], button: 'signin-class', note: 'General message about this class — write it in the last value.' },
  { name: 'class_starts_in_5_min_v2', audiences: ['session'], defaults: ['{name}', '{class}', '{day}', '{time}'], button: 'join', note: 'The button joins the class in one tap.' },
  { name: 'class_has_started_v2',    audiences: ['session'], defaults: ['{name}', '{class}'], button: 'join', note: 'The button joins the class in one tap.' },
  { name: 'class_link_changed_v1',   audiences: ['session'], defaults: ['{name}', '{class}', '{day}', '{time}'], button: 'signin-class' },
  { name: 'class_cancelled_v1',      audiences: ['session'], defaults: ['{name}', '{class}', '{day}', '{time}'], button: 'signin-schedule' },
  { name: 'class_rescheduled_v1',    audiences: ['session'], defaults: ['{name}', '{class}', '', '{when}'], button: 'signin-bookings', note: 'Fill in "Was" with the old day and time.' },
  { name: 'class_mentor_changed_v1', audiences: ['session'], defaults: ['{name}', '{class}', '{when}', '{mentor}'], button: 'signin-bookings' },
  { name: 'new_class_scheduled_v1',  audiences: ['session'], defaults: ['{name}', '{course}', '{class}', '{day}', '{time}'], button: 'signin-schedule' },
  { name: 'class_reminder_tomorrow', audiences: ['session'], defaults: ['{class}', '{when}'] },
  { name: 'class_starting_soon_v5',  audiences: ['session'], defaults: ['{class}', '5'] },
]
