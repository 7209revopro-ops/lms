import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Delta Institutions collects when you use the student website and app, and why.',
}

/* ─────────────────────────────────────────────────────────────
   DRAFT — written from what the LMS actually stores (plan.md §13.11), for
   Delta Institutions to review with its legal adviser before publishing.
   While DRAFT is true the page says so at the top. Items to settle:
     · the privacy contact address (none exists on the site today);
     · retention periods for each category;
     · the Terms' line "Delta shall not share your information with any third
       parties except as required by law" — the platform DOES use the service
       providers listed below; one of the two texts must change.
   Both app stores require this URL to be live before submission.
───────────────────────────────────────────────────────────── */
const DRAFT = true

const SECTIONS: { title: string; body: (string | string[])[] }[] = [
  {
    title: 'Who we are',
    body: [
      'Delta Institutions ("Delta", "we") runs the student website at lms.deltainstitutions.com and the Delta Institutions mobile app. This policy explains what personal data we collect when you use them, why, and the choices you have.',
    ],
  },
  {
    title: 'What we collect',
    body: [
      'Account: your name, email address and password (stored only as a one-way hash).',
      'Registration and enrolment (when you complete the full application): phone and WhatsApp number, emergency contact, gender, date of birth, nationality, home country, occupation, address, the type and number of your identity document, copies of your passport and identity document, a profile photo, your programmes, experience level, preferred start date, how you heard about us and your chosen payment method.',
      'Learning: your enrolments, lessons completed, video watch time, quiz attempts, private lesson notes, class bookings and attendance, class assignments you submit, reviews, messages with your mentors and support requests.',
      'Device and security: an identifier for each browser or phone you sign in from, its type and operating system, IP address, and sign-in times — used to protect your account and to enforce the device limit on your enrolment. In the app, a push-notification token for your phone if you allow notifications.',
      'Payments: the payment and invoice records needed to account for your course fees. Card details are entered with the payment provider and never reach our servers.',
    ],
  },
  {
    title: 'Why we use it',
    body: [
      [
        'to create and secure your account and decide your enrolment application;',
        'to run your courses and classes — bookings, reminders, joining links, attendance, progress and certificates;',
        'to let you message your mentors and our support team;',
        'to send service messages by email, WhatsApp and push notification (class reminders, booking changes, replies);',
        'to meet our legal, accounting and regulatory obligations, including those of the training regulator.',
      ],
      'We do not sell your personal data and do not use it for advertising.',
    ],
  },
  {
    title: 'Who processes it for us',
    body: [
      'We use service providers who process data on our behalf, only to provide these services: cloud hosting and file storage, email delivery, WhatsApp messaging, Google Meet and Calendar for online classes, video streaming for in-app classes and recordings, push-notification delivery for the app, crash reporting, and the payment providers you choose at checkout. Your academy\'s staff — admins and your mentors — see the information they need to teach and support you.',
    ],
  },
  {
    title: 'Your choices and rights',
    body: [
      'You can see and update your details in your account settings, and turn off push notifications in your phone\'s settings at any time.',
      'You can delete your account at any time — on the website in Settings, or in the app under Profile → Delete account. Deleting permanently removes your profile, enrolments, bookings, progress, notes and reviews. Payment and invoice records we must keep by law are retained without your login.',
      'To ask for a copy of your data or for any privacy question, contact us through Help & Support in your account.',
    ],
  },
  {
    title: 'Security',
    body: [
      'Data travels encrypted (HTTPS). Passwords are hashed; identity documents are stored privately and are visible only to authorised staff. In the app, your session is kept in the phone\'s secure storage.',
    ],
  },
  {
    title: 'Changes',
    body: ['We will post any change to this policy on this page, with the date it takes effect.'],
  },
]

export default function PrivacyPage() {
  return (
    <article className="space-y-8" style={{ color: 'var(--color-text-primary)' }}>
      {DRAFT && (
        <p className="rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: 'rgba(245,158,11,0.12)', color: '#92400E' }}>
          Draft — this policy is pending review and may change before it takes effect.
        </p>
      )}
      <header className="space-y-2">
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Privacy Policy</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Delta Institutions · student website and mobile app</p>
      </header>
      {SECTIONS.map(s => (
        <section key={s.title} className="space-y-3">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          {s.body.map((b, i) => Array.isArray(b)
            ? <ul key={i} className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{b.map(li => <li key={li}>{li}</li>)}</ul>
            : <p key={i} className="text-[15px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{b}</p>)}
        </section>
      ))}
    </article>
  )
}
