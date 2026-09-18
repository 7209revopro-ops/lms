import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import nodemailer, { type Transporter } from 'nodemailer'
import { logger } from '@/utils/logger.ts'
import { academyClock, academyTime } from '@/utils/academyClock.ts'

/* ─────────────────────────────────────────────────────
   EmailService
   ─────────────────────────────────────────────────────
   Single send() interface with two backends:

     - ConsoleEmailSender (default): writes the full HTML
       to `.logs/emails/*.html` for easy local preview.
       Used whenever SMTP isn't configured. No external
       network calls.

     - NodemailerEmailSender: used when SMTP_HOST +
       SMTP_USER + SMTP_PASS + EMAIL_FROM are set in env.
       Works with any SMTP provider (Gmail, Outlook,
       SendGrid SMTP, Mailgun, AWS SES SMTP, Brevo, etc).

   Wrappers expose typed helpers (sendPasswordReset,
   sendVerifyEmail, sendLiveClassScheduled) so callers
   don't deal with HTML.
───────────────────────────────────────────────────── */

export interface EmailMessage {
  to:      string
  subject: string
  html:    string
  text?:   string
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>
}

/* ─── Console sender (dev) ───────────────────────────── */
class ConsoleEmailSender implements EmailSender {
  /** Monotonic within the process — see the filename below. */
  private static seq = 0

  /* One directory per process when asked for.

     Suites that assert on mail read this directory back and filter it only by
     a timestamp watermark, which silently assumes they are the only writer.
     Run two suites at once -- or a suite alongside anything else that sends --
     and one process's mail is counted, and later deleted, by the other. A
     per-run directory makes that assumption true instead of hoping for it. */
  private readonly dir = process.env['EMAIL_LOG_DIR']?.trim()
    || join(process.cwd(), '.logs', 'emails')

  async send(msg: EmailMessage): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true })
      const safe = msg.to.replace(/[^a-z0-9@._-]/gi, '_')
      /* The sequence number is not decoration. The name used to be
         `${Date.now()}-${to}.html`, so two messages to the same address in the
         same millisecond landed on the same path and the second silently
         overwrote the first. That is not hypothetical: once critical mail
         started flushing in a batch, a reschedule and a reassignment for one
         student went out back-to-back and the maildir showed one of them — a
         suite then reported "receives both emails - 1 total" and the defect
         was in how mail was recorded, not in what was sent.

         Readers take the timestamp from the first `-` segment, so the counter
         goes second and leaves that parsing intact. */
      const file = join(this.dir, `${Date.now()}-${String(ConsoleEmailSender.seq++).padStart(4, '0')}-${safe}.html`)
      await writeFile(file, `<!-- to: ${msg.to} | subject: ${msg.subject} -->\n${msg.html}`, 'utf8')
      logger.info(
        { to: msg.to, subject: msg.subject, file },
        `📧  [dev] email captured`,
      )
    } catch (err) {
      logger.error({ err }, 'Email log write failed')
    }
  }
}

/* ─── Nodemailer sender (production) ─────────────────── */
class NodemailerEmailSender implements EmailSender {
  private readonly transporter: Transporter
  constructor(
    transporter: Transporter,
    private readonly fromEmail: string,
  ) {
    this.transporter = transporter
  }

  async send(msg: EmailMessage): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from:    this.fromEmail,
        to:      msg.to,
        subject: msg.subject,
        html:    msg.html,
        text:    msg.text,
      })
      logger.debug({ messageId: info.messageId, to: msg.to }, '📧  email sent')
    } catch (err) {
      logger.error({ err, to: msg.to }, 'Nodemailer send failed')
      throw err
    }
  }
}

/* ─────────────────────────────────────────────────────
   Failure classification
   ─────────────────────────────────────────────────────
   Three outcomes, and conflating them is how mail gets lost or spammed:

     PERMANENT — the address is wrong. No mailbox, no retry and no failover can
                 fix it, so fail fast and stop.
     QUOTA     — this mailbox is out of daily allowance. The message is fine;
                 the SENDER is not. Park this transport and try the next one.
     TRANSIENT — anything else (network, timeout, 4xx). Worth retrying later.

   550 alone cannot decide: Gmail returns it both for "Daily user sending limit
   exceeded" and for "No such user". The response text is what separates them.
─────────────────────────────────────────────────────── */
type Verdict = 'permanent' | 'quota' | 'transient'

function classify(err: unknown): Verdict {
  const e    = err as { responseCode?: number; response?: string; message?: string }
  const code = e?.responseCode
  const text = String(e?.response ?? e?.message ?? '').toLowerCase()

  if (/daily (user )?sending limit|sending quota|quota exceeded|5\.4\.5|domain policy size per unit time|too many (messages|recipients)|rate limit|try again later/.test(text)) {
    return 'quota'
  }
  if (/no such user|user unknown|mailbox unavailable|does not exist|invalid recipient|address rejected|recipient rejected|5\.1\.1/.test(text)) {
    return 'permanent'
  }
  /* An unqualified 5xx is permanent by definition; 4xx is explicitly temporary. */
  if (typeof code === 'number' && code >= 500 && code < 600) return 'permanent'
  return 'transient'
}

export class PermanentEmailError extends Error {}

/* ─────────────────────────────────────────────────────
   Transport pool — primary mailbox, then backup
   ─────────────────────────────────────────────────────
   Failover is driven by the SMTP RESPONSE, never by a message counter we keep
   ourselves. Google meters on a rolling 24-hour window and counts recipients
   rather than messages, so any local tally drifts from the real one: we would
   switch either too early (wasting paid capacity) or too late (bouncing mail).
   The server already tells us the moment we are out — that is the signal.

   A transport that reports quota is parked for SMTP_QUOTA_COOLDOWN_MIN and the
   next one takes over. Because the window is rolling, capacity trickles back,
   so the cooldown re-probes rather than waiting for a midnight that never
   really happens.
─────────────────────────────────────────────────────── */
export interface PooledTransport {
  name:          string
  transporter:   Transporter
  from:          string
  cooldownUntil: number
}

const COOLDOWN_MS = Number(process.env['SMTP_QUOTA_COOLDOWN_MIN'] ?? 60) * 60_000

export class PooledEmailSender implements EmailSender {
  constructor(private readonly transports: PooledTransport[]) {}

  /** Which mailboxes are usable right now — for diagnostics and tests. */
  status(): { name: string; cooling: boolean; cooldownUntil: number }[] {
    const now = Date.now()
    return this.transports.map(t => ({
      name: t.name, cooling: t.cooldownUntil > now, cooldownUntil: t.cooldownUntil,
    }))
  }

  async send(msg: EmailMessage): Promise<void> {
    const now = Date.now()
    const available = this.transports.filter(t => t.cooldownUntil <= now)

    /* Every mailbox is parked. Throwing keeps the outbox row pending so the
       drain replays it once a cooldown lapses — the message is late, not lost. */
    if (available.length === 0) {
      throw new Error('All email transports are in quota cooldown')
    }

    let lastErr: unknown
    for (const t of available) {
      try {
        const info = await t.transporter.sendMail({
          from: t.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
        })
        logger.debug({ messageId: info.messageId, to: msg.to, via: t.name }, 'email sent')
        return
      } catch (err) {
        lastErr = err
        const verdict = classify(err)

        if (verdict === 'permanent') {
          logger.warn({ to: msg.to, via: t.name, err }, 'permanent rejection — not retrying')
          throw new PermanentEmailError(String((err as Error)?.message ?? 'permanent rejection'))
        }
        if (verdict === 'quota') {
          t.cooldownUntil = Date.now() + COOLDOWN_MS
          logger.warn(
            { via: t.name, cooldownMin: COOLDOWN_MS / 60_000 },
            'mailbox hit its sending limit — failing over to the next one',
          )
          continue
        }
        logger.warn({ via: t.name, err }, 'transient send failure — trying next transport')
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All email transports failed')
  }
}

/* ─────────────────────────────────────────────────────
   Mailbox env resolution
   ─────────────────────────────────────────────────────
   The two mailboxes do NOT share a key naming scheme — the primary predates
   the pool, so it uses SMTP_HOST/EMAIL_FROM while the backup uses
   SMTP_BACKUP_HOST/SMTP_BACKUP_EMAIL_FROM. Deriving the backup's names by
   gluing a prefix onto the primary's produced SMTP_BACKUP_SMTP_HOST, which
   matches nothing: the backup silently never loaded and the pool ran with one
   mailbox. Nothing failed until the primary hit its cap — the one moment the
   backup exists for.

   So the key names are listed explicitly. Pure and exported, because this is
   exactly the wiring that needs a regression test.
─────────────────────────────────────────────────────── */
export interface MailboxKeys {
  host: string; port: string; user: string; pass: string; secure: string; from: string
}

export const PRIMARY_KEYS: MailboxKeys = {
  host: 'SMTP_HOST', port: 'SMTP_PORT', user: 'SMTP_USER',
  pass: 'SMTP_PASS', secure: 'SMTP_SECURE', from: 'EMAIL_FROM',
}
export const BACKUP_KEYS: MailboxKeys = {
  host: 'SMTP_BACKUP_HOST', port: 'SMTP_BACKUP_PORT', user: 'SMTP_BACKUP_USER',
  pass: 'SMTP_BACKUP_PASS', secure: 'SMTP_BACKUP_SECURE', from: 'SMTP_BACKUP_EMAIL_FROM',
}

export interface MailboxConfig {
  host: string; port: number; user: string; pass: string; secure: boolean; from: string
}

/** Resolve one mailbox from env, or null when it is not configured. */
export function resolveMailbox(
  keys: MailboxKeys,
  env: Record<string, string | undefined> = process.env,
): MailboxConfig | null {
  const host = env[keys.host]?.trim()
  const user = env[keys.user]?.trim()
  const pass = env[keys.pass]
  /* Gmail rejects a From the authenticated account is not allowed to send as,
     so each mailbox carries its own; EMAIL_FROM is the last resort. */
  const from = env[keys.from]?.trim() || env['EMAIL_FROM']?.trim()

  if (!host || !user || !pass || !from) return null

  const port = Number(env[keys.port] ?? 587)
  const secure = env[keys.secure]
    ? env[keys.secure] === 'true'
    : port === 465   // 465 = implicit TLS, 587 = STARTTLS, 25 = plain

  return { host, port, user, pass, secure, from }
}

/* ─── Singleton ──────────────────────────────────────── */
function buildTransport(keys: MailboxKeys, name: string): PooledTransport | null {
  const cfg = resolveMailbox(keys)
  if (!cfg) return null
  const { host, port, user, pass, secure, from } = cfg

  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } })

  void transporter.verify()
    .then(() => logger.info({ name, host, port, secure, from }, 'mailbox verified'))
    .catch(err => logger.error({ err, name, host, port }, 'mailbox verify failed — sends will still be attempted'))

  return { name, transporter, from, cooldownUntil: 0 }
}

export let emailPool: { status(): { name: string; cooling: boolean; cooldownUntil: number }[] } | null = null

function buildSender(): EmailSender {
  /* A test run must never reach a real mailbox. Suites load the project .env,
     so SMTP_* arrive fully populated and the pool would happily post to Gmail
     for every @t.local address a fixture invents — burning real daily quota and
     generating bounces that damage sender reputation. Three suites already
     blanked these by hand; relying on every future suite to remember is the
     kind of guard that fails exactly once and expensively. */
  if (process.env['NODE_ENV'] === 'test') {
    logger.info('Email backend: console (NODE_ENV=test — real SMTP is disabled)')
    return new ConsoleEmailSender()
  }

  const transports = [
    buildTransport(PRIMARY_KEYS, 'primary'),
    buildTransport(BACKUP_KEYS, 'backup'),
  ].filter((t): t is PooledTransport => t !== null)

  if (transports.length > 0) {
    const pool = new PooledEmailSender(transports)
    emailPool = pool
    logger.info(
      { mailboxes: transports.map(t => t.name + ' <' + t.from + '>') },
      'Email backend: SMTP pool of ' + transports.length + ' mailbox(es), failover on quota',
    )
    return pool
  }

  logger.info('Email backend: console (set SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM to enable real sending)')
  return new ConsoleEmailSender()
}

const rawSender = buildSender()

/* ─────────────────────────────────────────────────────
   Durable outbox
   ─────────────────────────────────────────────────────
   The mailbox pool raises the ceiling; this is what makes "no notification is
   lost" actually true. Every message is PERSISTED before it is attempted, so
   the row survives a refused send, a crashed process and a redeploy.

   Callers stay fire-and-forget (`void sendX().catch(log)`), which is why the
   old behaviour lost mail: the catch was the end of the story. Now the failure
   only leaves the row `pending`, and the drain job retries it with backoff
   until it goes out.

   Set EMAIL_OUTBOX=off to bypass and send inline — useful in tests and for
   anyone who would rather have the old behaviour back.
─────────────────────────────────────────────────────── */
const OUTBOX_ENABLED = process.env['EMAIL_OUTBOX'] !== 'off'

/* 1m, 5m, 15m, 1h, 4h, 12h, then daily — a quota block clears in hours, not
   seconds, so the tail is deliberately long rather than a tight retry spin. */
const BACKOFF_MIN = [1, 5, 15, 60, 240, 720, 1440]
export const MAX_EMAIL_ATTEMPTS = 10

export function backoffFor(attempts: number): number {
  const idx = Math.min(attempts, BACKOFF_MIN.length - 1)
  return BACKOFF_MIN[idx]! * 60_000
}

/** Attempt one already-persisted row. Exported so the drain job reuses it. */
export async function deliverOutboxRow(row: {
  id: string; to: string; subject: string; html: string; text?: string; attempts: number
}): Promise<'sent' | 'retry' | 'failed'> {
  const { EmailOutboxModel } = await import('@/models/schema.ts')
  try {
    await rawSender.send({ to: row.to, subject: row.subject, html: row.html, text: row.text })
    await EmailOutboxModel.updateOne({ _id: row.id }, {
      $set: { status: 'sent', sentAt: new Date() }, $unset: { lastError: 1 },
    })
    return 'sent'
  } catch (err) {
    const attempts   = row.attempts + 1
    const permanent  = err instanceof PermanentEmailError
    const exhausted  = attempts >= MAX_EMAIL_ATTEMPTS
    const message    = String((err as Error)?.message ?? err).slice(0, 500)

    if (permanent || exhausted) {
      await EmailOutboxModel.updateOne({ _id: row.id }, {
        $set: { status: 'failed', attempts, lastError: message },
      })
      logger.error({ to: row.to, attempts, permanent }, 'email permanently failed — needs a human')
      return 'failed'
    }

    await EmailOutboxModel.updateOne({ _id: row.id }, {
      $set: { attempts, lastError: message, nextAttemptAt: new Date(Date.now() + backoffFor(attempts)) },
    })
    return 'retry'
  }
}

/* Subjects embed caller-supplied record fields (class titles, course names).
   Strip CR/LF centrally so no call site can forge extra SMTP headers, and cap
   the length. Wrapping the sender means a new helper cannot forget to do it. */
const sender: EmailSender = {
  send: async msg => {
    const clean = { ...msg, subject: sanitiseSubject(msg.subject) }

    if (!OUTBOX_ENABLED) {
      await rawSender.send(clean)
      return
    }

    const { EmailOutboxModel } = await import('@/models/schema.ts')
    /* Persist FIRST. If the process dies between here and the send, the drain
       picks it up; if we sent first, the record of it would not exist. */
    const row = await EmailOutboxModel.create({
      to: clean.to, subject: clean.subject, html: clean.html, text: clean.text,
    })

    /* Try immediately so normal mail is not delayed by the drain interval.
       A failure is already recorded, so it is safe to swallow here. */
    await deliverOutboxRow({
      id: String(row._id), to: clean.to, subject: clean.subject,
      html: clean.html, text: clean.text, attempts: 0,
    })
  },
}

/* ─── Branded HTML wrapper ───────────────────────────── */
const DEFAULT_FOOTER = `You're receiving this because you signed up at Delta.
              If this wasn't you, you can safely ignore this email.`

function wrap(title: string, body: string, footer: string = DEFAULT_FOOTER): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F5F8;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0D0F1A;line-height:1.55">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F8;padding:40px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB">
          <tr>
            <td style="padding:28px 32px 0">
              <img src="${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/logo-email.png" alt="Delta International" width="72" height="34" style="display:block;height:34px;width:72px">
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px;font-size:14px;color:#374151">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid #F3F4F6;font-size:11px;color:#9CA3AF">
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/* ─── Typed helpers ─────────────────────────────────── */

export async function sendPasswordReset(to: string, name: string, resetUrl: string): Promise<void> {
  const subject = 'Reset your Delta password'
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Reset your password</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>We received a request to reset your password. Click the button below to choose a new one. The link expires in 60 minutes.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(resetUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Reset password
      </a>
    </p>
    <p style="font-size:12px;color:#6B7280">Or paste this URL into your browser:<br><span style="color:#0057b8">${escapeHtml(resetUrl)}</span></p>
    <p style="font-size:12px;color:#9CA3AF">If you didn't request this, ignore this email and your password will stay the same.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `Reset your Delta password by visiting: ${resetUrl}\n\nThe link expires in 60 minutes. If you didn't request this, ignore this email.`,
  })
}

/* Invitation from Delta AI Academy → one-click login link into the LMS that
   drops the recipient straight onto their course. Single-use link. */
export async function sendCourseInvite(to: string, name: string, link: string, courseName: string): Promise<void> {
  const subject = `You're invited to ${courseName} — Delta AI Academy`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Welcome to Delta AI Academy 🎉</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your access to <strong>${escapeHtml(courseName)}</strong> is ready. Tap the button below to sign in and jump straight into the course — no password needed.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(link))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Open my course
      </a>
    </p>
    <p style="font-size:12px;color:#6B7280">Or paste this link into your browser:<br><span style="color:#0057b8">${escapeHtml(link)}</span></p>
    <p style="font-size:12px;color:#9CA3AF">This link signs you in once and expires in 7 days. Didn't expect this? You can ignore this email.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `You're invited to ${courseName}. Sign in and open your course: ${link}\n\nThis link works once and expires in 7 days.`,
  })
}

/* Passwordless sign-in code (email → OTP login). Mirrors the reset email's
   shell so it reads as the same sender. The code expires in 10 minutes. */
export async function sendLoginCode(to: string, name: string, code: string): Promise<void> {
  const subject = `${code} is your Delta sign-in code`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Your sign-in code</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Enter this code to finish signing in. It expires in 10 minutes.</p>
    <p style="margin:24px 0;font-size:34px;font-weight:700;letter-spacing:0.18em;color:#0057b8">${escapeHtml(code)}</p>
    <p style="font-size:12px;color:#9CA3AF">Didn't try to sign in? You can ignore this email — nobody can get in without the code.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `Your Delta sign-in code is ${code}. It expires in 10 minutes. If you didn't request it, ignore this email.`,
  })
}

/* Tells an admin a student is waiting on a second-device approval, so the
   request doesn't sit unseen until someone happens to open the Devices page.
   Best-effort — a mail failure never blocks the sign-in flow it describes. */
export async function sendDeviceApprovalRequest(
  to: string,
  adminName: string,
  studentEmail: string,
  deviceLabel: string,
  reviewUrl: string,
): Promise<void> {
  const subject = 'A student is waiting for device approval'
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">New device to review</h2>
    <p>Hi ${escapeHtml(adminName)},</p>
    <p><strong>${escapeHtml(studentEmail)}</strong> is trying to sign in on a second device (${escapeHtml(deviceLabel)}). Students are limited to two devices, so this one needs your approval before they can watch on it.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(reviewUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Review devices
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF">If you don't recognise this, revoke the device from the same page — its session ends within minutes.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `${studentEmail} is waiting for approval on a second device (${deviceLabel}). Review devices: ${reviewUrl}`,
  })
}

/* Someone tried to register with an address that already has an account (M-05).
   Sent to the ACCOUNT HOLDER, never to whoever made the attempt — which turns
   a silent enumeration probe into something its owner can see. It is also
   simply the right message for the common innocent case: a real person who
   forgot they already signed up. Deliberately says nothing about the attempt
   beyond the fact of it — no IP, no name, nothing an attacker could plant. */
export async function sendRegistrationAttempt(to: string, name: string, signInUrl: string): Promise<void> {
  const subject = 'Someone tried to sign up with your email'
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">You already have a Delta account</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Someone just tried to create a Delta account using this email address. We did not create a second account, and nothing about your existing one has changed.</p>
    <p><strong>If that was you</strong>, you already have an account — just sign in below. If you have forgotten your password, use the reset link on the sign-in page.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(signInUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Sign in
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF">If it wasn't you, no action is needed — your account is untouched and no one gained access to it.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `Hi ${name},\n\nSomeone just tried to create a Delta account using this email address. We did not create a second account and nothing about your existing one has changed.\n\nIf that was you, sign in here: ${signInUrl}\n\nIf it wasn't you, no action is needed — your account is untouched.`,
  })
}

export async function sendVerifyEmail(to: string, name: string, verifyUrl: string): Promise<void> {
  const subject = 'Verify your Delta email'
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Welcome to Delta, ${escapeHtml(name)}</h2>
    <p>Confirm your email address to unlock notifications, certificates, and account recovery.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(verifyUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Verify email
      </a>
    </p>
    <p style="font-size:12px;color:#6B7280">Or paste this URL into your browser:<br><span style="color:#0057b8">${escapeHtml(verifyUrl)}</span></p>
    <p style="font-size:12px;color:#9CA3AF">The link expires in 24 hours.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `Verify your Delta email: ${verifyUrl}\nThis link expires in 24 hours.`,
  })
}

/* ── Changing the address on an account ──────────────────────────────────
   Two messages, and BOTH matter.

   The link goes to the NEW address, because the only thing that proves an
   address belongs to you is that you can read mail sent to it. The notice goes
   to the OLD one, because an email change is how a stolen session becomes a
   stolen account: the attacker moves the address, then uses forgot-password on
   it, and the real owner finds out when they can no longer sign in. A message
   to the address that is still live is the one chance they get to react while
   they still control the account. It is sent even though nothing has changed
   yet — waiting until the change completes would be too late to matter. */
export async function sendEmailChangeConfirm(to: string, name: string, confirmUrl: string): Promise<void> {
  const subject = 'Confirm your new Delta email address'
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Confirm this address, ${escapeHtml(name)}</h2>
    <p>You asked to use this address for your Delta account. Confirm it and it becomes the address you sign in with.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(confirmUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Confirm this address
      </a>
    </p>
    <p style="font-size:12px;color:#6B7280">Or paste this URL into your browser:<br><span style="color:#0057b8">${escapeHtml(confirmUrl)}</span></p>
    <p style="font-size:12px;color:#9CA3AF">The link expires in 1 hour. Until you confirm, your old address keeps working.</p>
  `)
  await sender.send({
    to, subject, html,
    text: `Confirm your new Delta email address: ${confirmUrl}\nThis link expires in 1 hour. Until you confirm, your old address keeps working.`,
  })
}

export async function sendEmailChangeNotice(to: string, name: string, newEmail: string): Promise<void> {
  const subject = 'Someone asked to change your Delta email address'
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Hello ${escapeHtml(name)}</h2>
    <p>A request was made to move your Delta account to <strong>${escapeHtml(newEmail)}</strong>.</p>
    <p><strong>Nothing has changed yet.</strong> The new address has to be confirmed first, and until then you keep signing in with this one.</p>
    <p style="margin:20px 0;padding:14px 16px;border-radius:12px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.22);color:#7F1D1D">
      If this was not you, change your password now — somebody may be signed in to your account.
    </p>
    <p style="font-size:12px;color:#9CA3AF">You are receiving this at your current address because it is still the one on the account.</p>
  `)
  await sender.send({
    to, subject, html,
    text: `A request was made to move your Delta account to ${newEmail}.\nNothing has changed yet — the new address must be confirmed first.\nIf this was not you, change your password now.`,
  })
}

export async function sendLiveClassScheduled(
  to: string,
  name: string,
  courseTitle: string,
  liveTitle: string,
  startsAt: Date,
  joinUrl: string,
): Promise<void> {
  const subject = `Live class scheduled: ${liveTitle}`
  const when = startsAt.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">A live class has been scheduled</h2>
    <p>Hi ${escapeHtml(name)}, a new live session is on the calendar for <strong>${escapeHtml(courseTitle)}</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="margin:18px 0;background:#F4F5F8;border-radius:12px;padding:16px;width:100%">
      <tr><td style="padding:8px 0"><strong>Session:</strong> ${escapeHtml(liveTitle)}</td></tr>
      <tr><td style="padding:8px 0"><strong>When:</strong> ${escapeHtml(when)}</td></tr>
    </table>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(joinUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Open course page
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF">You'll see a "Join now" button on the course page when the session goes live.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `A live class "${liveTitle}" has been scheduled for ${courseTitle} on ${when}. See ${joinUrl} for details.`,
  })
}

export async function sendInstructorClassScheduled(
  to: string,
  name: string,
  courseTitle: string,
  liveTitle: string,
  startsAt: Date,
  meetLink: string,
  /* The academy whose wall clock this reader thinks in. Absent falls back to
     Dubai, which is what every one of these printed before — unlabelled. */
  academySlug?: string | null,
): Promise<void> {
  const subject = `You've been scheduled: ${liveTitle}`
  const when = academyClock(startsAt, academySlug).full
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">You've been assigned a live class</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>A new live session has been scheduled for you in <strong>${escapeHtml(courseTitle)}</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="margin:18px 0;background:#F4F5F8;border-radius:12px;padding:16px;width:100%">
      <tr><td style="padding:6px 0"><strong>Session:</strong> ${escapeHtml(liveTitle)}</td></tr>
      <tr><td style="padding:6px 0"><strong>When:</strong> ${escapeHtml(when)}</td></tr>
      <tr><td style="padding:6px 0"><strong>Meet link:</strong> <a href="${escapeHtml(sanitiseUrl(meetLink))}" style="color:#0057b8">${escapeHtml(sanitiseUrl(meetLink))}</a></td></tr>
    </table>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(meetLink))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Open Google Meet
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF">You will receive another reminder 15 minutes before the class starts.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `You've been scheduled to teach "${liveTitle}" (${courseTitle}) on ${when}.\nGoogle Meet: ${meetLink}`,
  })
}

export async function sendInstructor15MinReminder(
  to: string,
  name: string,
  liveTitle: string,
  startsAt: Date,
  meetLink: string,
  academySlug?: string | null,
): Promise<void> {
  const subject = `⏰ Starting in 15 min: ${liveTitle}`
  const when = academyTime(startsAt, academySlug)
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Your class starts in 15 minutes</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p><strong>${escapeHtml(liveTitle)}</strong> starts at <strong>${escapeHtml(when)}</strong>. Open your Google Meet link now so you're ready when students join.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(meetLink))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:15px">
        Join Google Meet now →
      </a>
    </p>
    <p style="font-size:12px;color:#6B7280">Link: <a href="${escapeHtml(sanitiseUrl(meetLink))}" style="color:#0057b8">${escapeHtml(sanitiseUrl(meetLink))}</a></p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `Your class "${liveTitle}" starts at ${when} — join now: ${meetLink}`,
  })
}

export async function sendEnrollmentConfirmation(
  to: string,
  name: string,
  courseTitle: string,
  courseUrl: string,
): Promise<void> {
  const subject = `You're enrolled in ${courseTitle}`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">You're in! 🎉</h2>
    <p>Hi ${escapeHtml(name)}, you're now enrolled in <strong>${escapeHtml(courseTitle)}</strong>.</p>
    <p>Open the course any time and learn at your own pace. Your progress is saved automatically.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(courseUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Start learning →
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF">You can access this course any time from your My Learning page.</p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `You're enrolled in ${courseTitle}! Start learning: ${courseUrl}`,
  })
}

export async function sendCourseCompletion(
  to: string,
  name: string,
  courseTitle: string,
  courseUrl: string,
): Promise<void> {
  const subject = `You completed ${courseTitle} 🏆`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Course complete!</h2>
    <p>Congratulations, ${escapeHtml(name)}! You finished <strong>${escapeHtml(courseTitle)}</strong> from start to finish.</p>
    <table cellpadding="0" cellspacing="0" style="margin:18px 0;background:#F4F5F8;border-radius:12px;padding:16px;width:100%">
      <tr>
        <td style="padding:8px 0;font-size:22px">🏆</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#374151;padding:4px 0">
          <strong>${escapeHtml(courseTitle)}</strong> — 100% complete
        </td>
      </tr>
    </table>
    <p>Your certificate is waiting for you on the course page.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(courseUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        View certificate →
      </a>
    </p>
  `)
  await sender.send({
    to,
    subject,
    html,
    text: `Congratulations! You completed ${courseTitle}. View your certificate: ${courseUrl}`,
  })
}

/* ── Phase 5: Booking & Session reminder templates ──────── */

export async function sendBookingConfirmation(
  to: string,
  name: string,
  sessionTitle: string,
  sessionStart: Date | string,
  academySlug?: string | null,
): Promise<void> {
  const d = new Date(sessionStart)
  const { date: dateStr, time: timeStr } = academyClock(d, academySlug)
  const subject = `✅ Class Booking Confirmed`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">✅ Class Booking Confirmed</h2>
    <p style="margin:0 0 16px;color:#374151">Dear ${escapeHtml(name)},</p>
    <p style="margin:0 0 20px;color:#374151">Your class has been successfully booked.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#F4F5F8;border-radius:12px;padding:16px;width:100%;border:1px solid #E5E7EB">
      <tr><td style="font-size:14px;color:#374151;padding:6px 0">
        <strong>Date:</strong> ${dateStr}
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:6px 0">
        <strong>Time:</strong> ${timeStr}
      </td></tr>
    </table>
    <p style="margin:0 0 20px;color:#374151">You will receive the session joining link <strong>5 minutes before the class begins</strong>.</p>
    <p style="margin:0 0 24px;color:#374151">Please be available and join the session on time.</p>
    <p style="margin:0;color:#374151">Thank you,<br><strong>Delta Academy</strong></p>
  `)
  await sender.send({ to, subject, html, text: `Dear ${name},\n\nYour class has been successfully booked.\n\nDate: ${dateStr}\nTime: ${timeStr}\n\nYou will receive the session joining link 5 minutes before the class begins.\n\nPlease be available and join the session on time.\n\nThank you,\nDelta Academy` })
}

export async function sendSessionLinkReminder(
  to: string,
  name: string,
  sessionTitle: string,
  date: string,
  joinUrl: string,
): Promise<void> {
  const subject = `Tomorrow: ${sessionTitle}`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Your session is tomorrow 📅</h2>
    <p>Hi ${escapeHtml(name)}, just a reminder that <strong>${escapeHtml(sessionTitle)}</strong> is scheduled for tomorrow.</p>
    <table cellpadding="0" cellspacing="0" style="margin:18px 0;background:#F4F5F8;border-radius:12px;padding:16px;width:100%">
      <tr><td style="font-size:14px;color:#374151;padding:4px 0">
        <strong>Date &amp; Time:</strong> ${escapeHtml(date)}
      </td></tr>
    </table>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(joinUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Join session →
      </a>
    </p>
  `)
  await sender.send({ to, subject, html, text: `${sessionTitle} is tomorrow at ${date}. Join: ${joinUrl}` })
}

export async function sendDayOfReminder(
  to: string,
  name: string,
  sessionTitle: string,
  time: string,
  joinUrl: string,
): Promise<void> {
  const subject = `Today: ${sessionTitle} at ${time}`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Session today! ⏰</h2>
    <p>Hi ${escapeHtml(name)}, <strong>${escapeHtml(sessionTitle)}</strong> is happening today at <strong>${escapeHtml(time)}</strong>.</p>
    <p>Get ready and make sure your connection is stable.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(joinUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Join session →
      </a>
    </p>
  `)
  await sender.send({ to, subject, html, text: `${sessionTitle} is today at ${time}. Join: ${joinUrl}` })
}

/**
 * 30-min reminder — NO join link.
 * The link is withheld intentionally; it is sent at the 5-min reminder instead.
 */
export async function sendPreSessionReminder(
  to: string,
  name: string,
  sessionTitle: string,
  minutesLeft: number,
): Promise<void> {
  const subject = `Starting in ${minutesLeft} mins: ${sessionTitle}`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Starting soon! 🚀</h2>
    <p>Hi ${escapeHtml(name)}, <strong>${escapeHtml(sessionTitle)}</strong> starts in <strong>${minutesLeft} minutes</strong>.</p>
    <p>Get ready — make sure your device and connection are set. The join link will arrive in a separate email 5 minutes before the session starts.</p>
    <p style="margin:24px 0">
      <a href="${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/class-bookings"
        style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        View my schedule →
      </a>
    </p>
  `)
  await sender.send({ to, subject, html, text: `${sessionTitle} starts in ${minutesLeft} minutes. The join link will be sent 5 minutes before the session.` })
}

/** 5-min reminder — WITH join link */
export async function sendFiveMinReminder(
  to: string,
  name: string,
  sessionTitle: string,
  joinUrl: string,
  sessionStart: Date | string,
  academySlug?: string | null,
): Promise<void> {
  const d = new Date(sessionStart)
  const { date: dateStr, time: timeStr } = academyClock(d, academySlug)
  const subject = `🔔 Your Class Starts in 5 Minutes`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">🔔 Your Class Starts in 5 Minutes</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px;color:#374151">This is a reminder that your class will begin in <strong>5 minutes</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#F4F5F8;border-radius:12px;padding:16px;width:100%;border:1px solid #E5E7EB">
      <tr><td style="font-size:14px;color:#374151;padding:6px 0">
        <strong>Date:</strong> ${dateStr}
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:6px 0">
        <strong>Time:</strong> ${timeStr}
      </td></tr>
    </table>
    <p style="margin:0 0 12px;color:#374151"><strong>Join the session here:</strong></p>
    <p style="margin:0 0 20px">
      <a href="${escapeHtml(sanitiseUrl(joinUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:15px">
        Join Now →
      </a>
    </p>
    <p style="margin:0 0 20px;color:#374151">Please join a few minutes early to ensure a smooth start.</p>
    <p style="margin:0 0 4px;color:#374151">See you in class!</p>
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)
  await sender.send({ to, subject, html, text: `Dear ${name},\n\nThis is a reminder that your class will begin in 5 minutes.\n\nDate: ${dateStr}\nTime: ${timeStr}\n\nJoin the session here: ${joinUrl}\n\nPlease join a few minutes early to ensure a smooth start.\n\nSee you in class!\nDelta Academy` })
}

/** At-time reminder — WITH join link, sent when class has just started */
export async function sendClassStartingReminder(
  to: string,
  name: string,
  sessionTitle: string,
  joinUrl: string,
): Promise<void> {
  const subject = `🚀 Class Has Started`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">🚀 Class Has Started</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px;color:#374151">Your scheduled class has now started.</p>
    <p style="margin:0 0 20px;color:#374151">If you have not already joined, please use your session link to enter the class.</p>
    <p style="margin:0 0 24px">
      <a href="${escapeHtml(sanitiseUrl(joinUrl))}" style="display:inline-block;background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:15px">
        Join Now →
      </a>
    </p>
    <p style="margin:0 0 24px;color:#374151">We look forward to your participation.</p>
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)
  await sender.send({ to, subject, html, text: `Dear ${name},\n\nYour scheduled class has now started.\n\nIf you have not already joined, please use your session link to enter the class: ${joinUrl}\n\nWe look forward to your participation.\n\nDelta Academy` })
}

export async function sendRescheduledNotification(
  to: string,
  name: string,
  sessionTitle: string,
  oldStart: Date | string,
  newStart: Date | string,
  academySlug?: string | null,
): Promise<void> {
  const fmt = (dt: Date | string) => {
    const d = new Date(dt)
    const { date, time } = academyClock(d, academySlug)
    return `${date} at ${time}`
  }
  const oldLabel = fmt(oldStart)
  const newLabel = fmt(newStart)
  const subject = `📅 Class Rescheduled`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">📅 Class Rescheduled</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px;color:#374151">Your scheduled class has been rescheduled.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#F4F5F8;border-radius:12px;padding:16px;width:100%;border:1px solid #E5E7EB">
      <tr><td style="font-size:14px;color:#374151;padding:6px 0">
        <strong>Previous Schedule:</strong> <span style="text-decoration:line-through;color:#9CA3AF">${oldLabel}</span>
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:6px 0;border-top:1px solid #E5E7EB">
        <strong>New Schedule:</strong> ${newLabel}
      </td></tr>
    </table>
    <p style="margin:0 0 20px;color:#374151">If the session is conducted online, the joining link will be shared <strong>5 minutes before the class begins</strong>.</p>
    <p style="margin:0 0 20px;color:#374151">Thank you for your cooperation. We look forward to seeing you in the rescheduled session.</p>
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)
  await sender.send({ to, subject, html, text: `Dear ${name},\n\nYour scheduled class has been rescheduled.\n\nPrevious Schedule: ${oldLabel}\nNew Schedule: ${newLabel}\n\nIf the session is conducted online, the joining link will be shared 5 minutes before the class begins.\n\nThank you for your cooperation. We look forward to seeing you in the rescheduled session.\n\nDelta Academy` })
}

/* ── Reschedule email sequence (3 emails sent at different times) ── */

export async function sendDelayNotification(
  to: string,
  name: string,
  sessionTitle: string,
  newStart: Date | string,
  academySlug?: string | null,
): Promise<void> {
  const d = new Date(newStart)
  const timeStr = academyTime(d, academySlug)
  const subject = `⏳ Class Delay Notice`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">⏳ Class Delay Notice</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px;color:#374151">Your scheduled class has been delayed.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#F4F5F8;border-radius:12px;padding:16px;width:100%;border:1px solid #E5E7EB">
      <tr><td style="font-size:14px;color:#374151;padding:6px 0">
        <strong>Revised Start Time:</strong> ${timeStr}
      </td></tr>
    </table>
    <p style="margin:0 0 20px;color:#374151">We apologize for the inconvenience and appreciate your patience. If applicable, you may continue to use the same joining link unless notified otherwise.</p>
    <p style="margin:0 0 24px;color:#374151">Thank you.</p>
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)
  await sender.send({ to, subject, html, text: `Dear ${name},\n\nYour scheduled class has been delayed.\n\nRevised Start Time: ${timeStr}\n\nWe apologize for the inconvenience and appreciate your patience. If applicable, you may continue to use the same joining link unless notified otherwise.\n\nThank you.\n\nDelta Academy` })
}

interface RescheduledArgs {
  to:      string
  name:    string
  title:   string
  oldDate: string
  newDate: string
  reason:  string
}

export async function sendRescheduledEmail1(args: RescheduledArgs): Promise<void> {
  const { to, name, title, oldDate, newDate, reason } = args
  const subject = `Important: ${title} has been rescheduled`
  const html = wrap(subject, `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0D0F1A">Session rescheduled</h2>
    <p style="margin:0 0 20px;font-size:13px;color:#6B7280">Schedule change notification — please read carefully.</p>
    <p>Hi ${escapeHtml(name)},</p>
    <p>We sincerely apologize for the inconvenience. <strong>${escapeHtml(title)}</strong> has been rescheduled to a new date and time. Please review the updated details below.</p>
    <table cellpadding="0" cellspacing="0" style="margin:20px 0;background:#F4F5F8;border-radius:12px;padding:0;width:100%;border-collapse:separate;overflow:hidden">
      <tr style="background:#EFF0F4">
        <td style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6B7280;padding:10px 16px">Previous time</td>
        <td style="font-size:14px;color:#9CA3AF;padding:10px 16px;text-align:right;text-decoration:line-through">${escapeHtml(oldDate)}</td>
      </tr>
      <tr>
        <td style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6B7280;padding:10px 16px;border-top:1px solid #E5E7EB">New time</td>
        <td style="font-size:15px;font-weight:700;color:#059669;padding:10px 16px;border-top:1px solid #E5E7EB;text-align:right">${escapeHtml(newDate)}</td>
      </tr>
      <tr style="background:#EFF0F4">
        <td colspan="2" style="font-size:13px;color:#374151;padding:12px 16px;border-top:1px solid #E5E7EB">
          <strong>Reason for change:</strong><br>
          <span style="color:#4B5563;margin-top:4px;display:block">${escapeHtml(reason)}</span>
        </td>
      </tr>
    </table>
    <p>Your booking has been <strong>automatically updated</strong> to the new time. No action is required — your seat is still reserved.</p>
    <p>We will send you a reminder before the rescheduled session. We apologize once again for any disruption and truly appreciate your understanding.</p>
    <div style="margin:20px 0;background:#FEF9C3;border:1px solid #FDE047;border-radius:10px;padding:14px 16px">
      <p style="margin:0;font-size:13px;color:#854D0E">
        🔗 <strong>Your join link</strong> will be sent to you <strong>5 minutes before</strong> the class begins — keep an eye on your inbox!
      </p>
    </div>
    <p style="margin:24px 0">
      <a href="${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/class-bookings"
        style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:15px">
        View my updated schedule →
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF">If you have any questions or concerns, please reach out to the admin team. We are happy to assist.</p>
  `)
  await sender.send({ to, subject, html, text: `${title} has been rescheduled from ${oldDate} to ${newDate}. Reason: ${reason}` })
}

export async function sendRescheduledEmail2(args: RescheduledArgs): Promise<void> {
  const { to, name, title, newDate, reason } = args
  const subject = `Following up: Updated schedule for "${title}"`
  const html = wrap(subject, `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0D0F1A">A quick follow-up on your class</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>We wanted to follow up to ensure you received our earlier notification about the schedule change for <strong>${escapeHtml(title)}</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="margin:20px 0;background:rgba(0,87,184,0.06);border-left:3px solid #0057b8;border-radius:0 12px 12px 0;padding:18px 20px;width:100%">
      <tr><td style="font-size:15px;font-weight:700;color:#1F2937;padding:0 0 8px">
        📅 ${escapeHtml(newDate)}
      </td></tr>
      <tr><td style="font-size:13px;color:#6B7280">
        <strong style="color:#374151">Why we changed it:</strong> ${escapeHtml(reason)}
      </td></tr>
    </table>
    <p>We understand that schedule changes can be inconvenient, and we truly appreciate your patience. Rest assured that the team is fully committed to delivering the best possible learning experience for you at this new time.</p>
    <p><strong>You don't need to do anything</strong> — your seat is confirmed and your booking has already been updated automatically.</p>
    <p style="margin:24px 0">
      <a href="${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/class-bookings"
        style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:15px">
        Check my bookings →
      </a>
    </p>
    <div style="margin:20px 0;background:#FEF9C3;border:1px solid #FDE047;border-radius:10px;padding:14px 16px">
      <p style="margin:0;font-size:13px;color:#854D0E">
        🔗 <strong>Your join link</strong> will be delivered to your inbox <strong>5 minutes before</strong> the session starts.
      </p>
    </div>
    <p>We look forward to seeing you at the new time. Thank you for your continued trust and understanding.</p>
  `)
  await sender.send({ to, subject, html, text: `Reminder: ${title} has been rescheduled. New time: ${newDate}. Reason: ${reason}.` })
}

export async function sendRescheduledEmail3(args: RescheduledArgs): Promise<void> {
  const { to, name, title, newDate, reason } = args
  const subject = `Reminder: Your rescheduled class — ${title}`
  const html = wrap(subject, `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0D0F1A">Your class is coming up 📚</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>This is a friendly reminder that your rescheduled session of <strong>${escapeHtml(title)}</strong> is approaching. We want to make sure you are fully prepared and ready for a great learning experience.</p>
    <table cellpadding="0" cellspacing="0" style="margin:20px 0;background:linear-gradient(135deg,rgba(5,150,105,0.08),rgba(16,185,129,0.06));border:1px solid rgba(5,150,105,0.2);border-radius:12px;padding:18px;width:100%">
      <tr><td style="font-size:16px;font-weight:700;color:#059669;padding:0 0 6px">
        📅 ${escapeHtml(newDate)}
      </td></tr>
      <tr><td style="font-size:12px;color:#6B7280">
        This is the rescheduled time for your class. Original change reason: <em>${escapeHtml(reason)}</em>
      </td></tr>
    </table>
    <p>To make the most of this session, we recommend reviewing any notes or materials from previous classes beforehand. The instructor will be fully prepared to deliver an outstanding lesson.</p>
    <div style="margin:20px 0;background:#FEF9C3;border:1px solid #FDE047;border-radius:10px;padding:14px 16px">
      <p style="margin:0;font-size:13px;color:#854D0E">
        🔗 <strong>Your join link</strong> will arrive in your inbox <strong>5 minutes before</strong> the class begins — no action needed now.
      </p>
    </div>
    <p>We would like to once again express our sincerest apologies for the rescheduling and thank you for your patience and flexibility. Your commitment to learning is truly appreciated.</p>
    <p style="margin:24px 0">
      <a href="${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/class-bookings"
        style="display:inline-block;background:linear-gradient(135deg,#059669,#10B981);color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:15px">
        View session details →
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF">We look forward to seeing you in class. See you soon! 🎓</p>
  `)
  await sender.send({ to, subject, html, text: `Reminder: ${title} is scheduled for ${newDate}. We look forward to seeing you in class!` })
}

/* ── Instructor change ─────────────────────────────────────────────────────
   Sent to every student holding a live booking when the session's instructor
   is reassigned. Reschedules and cancellations already had a notice; a change
   of who is actually teaching did not, even though it is the one detail a
   student books around most often after the time. */
export async function sendInstructorChangedNotification(
  to: string,
  name: string,
  sessionTitle: string,
  oldInstructor: string,
  newInstructor: string,
  sessionStart: Date | string,
  academySlug?: string | null,
): Promise<void> {
  const d = new Date(sessionStart)
  const { date: dateStr, time: timeStr } = academyClock(d, academySlug)
  const subject = `📣 Instructor Update — ${sessionTitle}`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Instructor Update</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px;color:#374151">The instructor for a session you have booked has changed. The date and time are unchanged.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#F4F5F8;border-radius:12px;padding:16px;width:100%;border:1px solid #E5E7EB">
      <tr><td style="font-size:14px;color:#374151;padding:6px 0">
        <strong>Session:</strong> ${escapeHtml(sessionTitle)}
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:6px 0;border-top:1px solid #E5E7EB">
        <strong>Previous Instructor:</strong> <span style="text-decoration:line-through;color:#9CA3AF">${escapeHtml(oldInstructor)}</span>
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:6px 0;border-top:1px solid #E5E7EB">
        <strong>New Instructor:</strong> ${escapeHtml(newInstructor)}
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:6px 0;border-top:1px solid #E5E7EB">
        <strong>When:</strong> ${dateStr} at ${timeStr}
      </td></tr>
    </table>
    <p style="margin:0 0 20px;color:#374151">Your booking is still confirmed — there is nothing you need to do.</p>
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)
  await sender.send({
    to, subject, html,
    text: `Dear ${name},\n\nThe instructor for a session you have booked has changed. The date and time are unchanged.\n\nSession: ${sessionTitle}\nPrevious Instructor: ${oldInstructor}\nNew Instructor: ${newInstructor}\nWhen: ${dateStr} at ${timeStr}\n\nYour booking is still confirmed — there is nothing you need to do.\n\nDelta Academy`,
  })
}

/** The once-a-day Standard-tier digest: everything that changed, in one mail.

    One email instead of one per event is the entire point — a student who had
    four sessions added across three courses used to get four separate mails,
    which is the volume the notification spec was written to stop. */
export async function sendDailyDigest(
  to: string,
  name: string,
  items: { title: string; body: string }[],
  scheduleUrl: string,
): Promise<void> {
  /* Singular when there is one. A digest that says "1 updates" reads like a
     machine wrote it, and the whole redesign is about mail that respects the
     reader. */
  const count   = items.length
  const subject = count === 1
    ? `1 update in your classes today`
    : `${count} updates in your classes today`

  const rows = items.map(i => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB">
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0D0F1A">${escapeHtml(i.title)}</p>
      <p style="margin:0;font-size:13px;color:#374151">${escapeHtml(i.body)}</p>
    </td></tr>`).join('')

  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Here's what changed in your classes today</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px">${rows}</table>
    <p style="margin:0 0 24px">
      <a href="${escapeHtml(sanitiseUrl(scheduleUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:15px">
        View my schedule →
      </a>
    </p>
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)

  /* Assembled from an array rather than one long template literal.
     The plain-text half needs real line breaks between items, and
     embedding them inside a nested template is how this got mangled
     the first time round. */
  const lines = [
    `Dear ${name},`, '',
    `Here's what changed in your classes today:`, '',
    ...items.flatMap(i => [`• ${i.title}`, `  ${i.body}`]),
    '',
    `View my schedule: ${scheduleUrl}`, '',
    'Delta Academy',
  ]
  const text = lines.join(String.fromCharCode(10))

  await sender.send({ to, subject, html, text })
}

export async function sendCancelledNotification(
  to: string,
  name: string,
  sessionTitle: string,
  sessionStart: Date | string,
  academySlug?: string | null,
): Promise<void> {
  const d = new Date(sessionStart)
  const { date: dateStr, time: timeStr } = academyClock(d, academySlug)
  const subject = `❗ Class Cancellation Notice`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">❗ Class Cancellation Notice</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px;color:#374151">We regret to inform you that your scheduled class on <strong>${dateStr} at ${timeStr}</strong> has been cancelled.</p>
    <p style="margin:0 0 20px;color:#374151">We apologize for the inconvenience. A replacement session will be scheduled, and you will be notified once it is available.</p>
    <p style="margin:0 0 24px;color:#374151">Thank you for your understanding.</p>
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)
  await sender.send({ to, subject, html, text: `Dear ${name},\n\nWe regret to inform you that your scheduled class on ${dateStr} at ${timeStr} has been cancelled.\n\nWe apologize for the inconvenience. A replacement session will be scheduled, and you will be notified once it is available.\n\nThank you for your understanding.\n\nDelta Academy` })
}

export async function sendBookingCancelledByStudent(
  to: string,
  name: string,
  sessionTitle: string,
  date: string,
): Promise<void> {
  const subject = `Booking cancelled: ${sessionTitle}`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Booking cancelled</h2>
    <p>Hi ${escapeHtml(name)}, your booking for <strong>${escapeHtml(sessionTitle)}</strong> has been successfully cancelled.</p>
    <table cellpadding="0" cellspacing="0" style="margin:18px 0;background:#F4F5F8;border-radius:12px;padding:16px;width:100%">
      <tr><td style="font-size:14px;color:#374151;padding:4px 0">
        <strong>Session:</strong> ${escapeHtml(sessionTitle)}
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:4px 0">
        <strong>Scheduled for:</strong> ${escapeHtml(date)}
      </td></tr>
    </table>
    <p>Your seat has been released. You can book a different time slot from the Class Schedule page.</p>
    <p style="margin:24px 0">
      <a href="${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/class-bookings"
        style="display:inline-block;background:#F3F4F6;color:#374151;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        View Class Schedule →
      </a>
    </p>
    <p style="font-size:12px;color:#9CA3AF">If you didn't request this cancellation, please contact the admin team.</p>
  `)
  await sender.send({ to, subject, html, text: `Your booking for ${sessionTitle} on ${date} has been cancelled. Book again: ${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/class-bookings` })
}

const CATEGORY_LABEL: Record<string, string> = {
  '4x-trading':        'FOREX',
  'jura':              'JURA',
  'digital-marketing': 'Digital Marketing',
  'ai':                'AI',
}

export async function sendEnrollmentApproved(
  to: string,
  name: string,
  category: string,
): Promise<void> {
  const prog = CATEGORY_LABEL[category] ?? category
  const subject = `Your ${prog} access has been approved!`
  const dashUrl = `${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/my-learning`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">You're in! 🎉</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Great news — your access to the <strong>${escapeHtml(prog)}</strong> program has been approved. You can now book and join live sessions.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(dashUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Go to my learning →
      </a>
    </p>
  `)
  await sender.send({ to, subject, html, text: `Your ${prog} program access has been approved. Visit ${dashUrl} to get started.` })
}

/* Welcome mail for bulk-imported students: their account already exists and is
   approved, so the only step is setting a password via a 7-day link. Sent by
   src/scripts/import-dubai-students.ts — the regular approval mail is
   deliberately NOT sent for these accounts. */
export async function sendImportedStudentWelcome(
  to: string,
  name: string,
  category: string,
  setPasswordUrl: string,
): Promise<void> {
  const prog     = CATEGORY_LABEL[category] ?? category
  const subject  = `Welcome to Delta International — your ${prog} portal is ready`
  const loginUrl = `${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/login?from=%2Fmy-learning`
  const safeSet  = escapeHtml(sanitiseUrl(setPasswordUrl))
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Welcome to Delta International 🎓</h2>
    <p style="margin:0 0 12px">Dear ${escapeHtml(name)},</p>
    <p style="margin:0 0 12px">This is the Admin Team at <strong>Delta International</strong> — welcome to the <strong>${escapeHtml(prog)}</strong> program! We're delighted to have you on board.</p>
    <p style="margin:0 0 20px">Your <strong>LMS student portal account has already been created and approved</strong> by our team, so there's no registration form to fill in. Just one step remains — set your password to activate your account:</p>
    <p style="margin:0 0 24px;text-align:center">
      <a href="${safeSet}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#ffffff;font-weight:600;padding:13px 32px;border-radius:12px;text-decoration:none;font-size:15px">
        Set My Password &amp; Activate →
      </a>
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;margin:0 0 20px">
      <tr>
        <td style="padding:18px 20px;font-size:13.5px;color:#374151">
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em">Getting started</p>
          <p style="margin:0 0 8px"><strong style="color:#0057b8">1.</strong>&nbsp; Click the button above and choose your password <span style="color:#9CA3AF">(link valid for 7 days)</span></p>
          <p style="margin:0 0 8px"><strong style="color:#0057b8">2.</strong>&nbsp; Sign in at <a href="${escapeHtml(sanitiseUrl(loginUrl))}" style="color:#0057b8;text-decoration:none;font-weight:600">the student portal</a> using this email address</p>
          <p style="margin:0"><strong style="color:#0057b8">3.</strong>&nbsp; You'll land on <strong>My Learning</strong> — book your classes, join live sessions, and track your progress</p>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF5FF;border-left:4px solid #0057b8;border-radius:0 12px 12px 0;margin:0 0 20px">
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#003d80">
          <strong>Link expired?</strong> No problem — open the login page and use <em>“Forgot password?”</em> with this email address to receive a fresh link.
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px">If you run into any trouble, simply reply to this email or reach out to us directly — we'll help you sort it out right away.</p>
    <p style="margin:0 0 4px">Looking forward to seeing you in class!</p>
    <p style="margin:16px 0 0;color:#0D0F1A"><strong>Warm regards,</strong><br>
    Admin Team — ${escapeHtml(prog)}<br>
    <span style="color:#6B7280">Delta International</span></p>
  `, `You're receiving this email because you are enrolled as a student at Delta International.
              If you think this was sent in error, please contact our support team.`)
  const text = `Dear ${name},\n\nWelcome to the ${prog} program at Delta International! Your student portal account has already been created and approved. Set your password to activate it (link valid 7 days):\n${setPasswordUrl}\n\nThen sign in at ${loginUrl} with this email address.\nIf the link expires, use "Forgot password?" on the login page.\n\nAdmin Team — ${prog}\nDelta International`
  await sender.send({ to, subject, html, text })
}

export async function sendEnrollmentCancelled(
  to: string,
  name: string,
  category: string,
  reason: string,
): Promise<void> {
  const prog = CATEGORY_LABEL[category] ?? category
  const subject = `Update on your ${prog} access request`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">Access request update</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>We've reviewed your access request for the <strong>${escapeHtml(prog)}</strong> program.</p>
    <div style="background:#FEF2F2;border-left:4px solid #EF4444;padding:16px 20px;border-radius:0 12px 12px 0;margin:20px 0">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#DC2626;text-transform:uppercase;letter-spacing:0.05em">Access not approved</p>
      <p style="margin:0;font-size:14px;color:#374151">${escapeHtml(reason)}</p>
    </div>
    <p>If you believe this is a mistake or have any questions, please reach out to our support team and we'll be happy to help.</p>
  `)
  await sender.send({ to, subject, html, text: `Your ${prog} access request was not approved. Reason: ${reason}` })
}

export async function sendNewEnrollmentRequestToAdmin(
  to: string,
  adminName: string,
  studentName: string,
  studentEmail: string,
  category: string,
): Promise<void> {
  const prog = CATEGORY_LABEL[category] ?? category
  const subject = `New ${prog} signup — approval needed`
  const requestsUrl = `${process.env['ADMIN_URL'] ?? 'http://localhost:3001'}/enrollment-requests`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">New student signup 🔔</h2>
    <p>Hi ${escapeHtml(adminName)},</p>
    <p>A new student has signed up for the <strong>${escapeHtml(prog)}</strong> program and is waiting for your approval.</p>
    <table cellpadding="0" cellspacing="0" style="margin:18px 0;background:#F4F5F8;border-radius:12px;padding:16px;width:100%">
      <tr><td style="font-size:14px;color:#374151;padding:4px 0">
        <strong>Name:</strong> ${escapeHtml(studentName)}
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:4px 0">
        <strong>Email:</strong> ${escapeHtml(studentEmail)}
      </td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:4px 0">
        <strong>Program:</strong> ${escapeHtml(prog)}
      </td></tr>
    </table>
    <p>Review the request and approve or deny access in the admin panel.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(sanitiseUrl(requestsUrl))}" style="display:inline-block;background:linear-gradient(135deg,#0057b8,#2F6BFF);color:#fff;font-weight:600;padding:12px 24px;border-radius:12px;text-decoration:none">
        Review request →
      </a>
    </p>
  `)
  await sender.send({ to, subject, html, text: `New ${prog} signup from ${studentName} (${studentEmail}). Review at ${requestsUrl}` })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!))
}

function sanitiseSubject(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)   // CRLF = SMTP header injection
}

function sanitiseUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '#'
    return url.toString()
  } catch {
    return '#'
  }
}

/* ── Class assignments (student → instructor) ───────────────────────────── */

export async function sendAssignmentSubmitted(
  to: string,
  instructorName: string,
  assignmentTitle: string,
  sessionTitle: string,
  attempt: number,
): Promise<void> {
  const isRevision = attempt > 1
  const subject = isRevision
    ? `📎 Revised assignment — ${sessionTitle}`
    : `📎 New assignment — ${sessionTitle}`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">${isRevision ? 'Revised assignment' : 'New assignment'}</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(instructorName)}</strong>,</p>
    <p style="margin:0 0 20px;color:#374151">A student has sent work for your review${isRevision ? ` (attempt ${attempt})` : ''}.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#F4F5F8;border-radius:12px;padding:16px;width:100%;border:1px solid #E5E7EB">
      <tr><td style="font-size:14px;color:#374151;padding:6px 0"><strong>Class:</strong> ${escapeHtml(sessionTitle)}</td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:6px 0;border-top:1px solid #E5E7EB"><strong>Assignment:</strong> ${escapeHtml(assignmentTitle)}</td></tr>
    </table>
    <p style="margin:0 0 20px;color:#374151">Open the Assignments section to approve it, or send it back with a reason.</p>
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)
  await sender.send({
    to, subject, html,
    text: `Dear ${instructorName},\n\nA student has sent work for your review${isRevision ? ` (attempt ${attempt})` : ''}.\n\nClass: ${sessionTitle}\nAssignment: ${assignmentTitle}\n\nOpen the Assignments section to approve it, or send it back with a reason.\n\nDelta Academy`,
  })
}

export async function sendAssignmentReviewed(
  to: string,
  studentName: string,
  assignmentTitle: string,
  sessionTitle: string,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<void> {
  const approved = decision === 'approved'
  const subject = approved
    ? `✅ Assignment approved — ${sessionTitle}`
    : `📝 Assignment sent back — ${sessionTitle}`
  const body = approved
    ? `<p style="margin:0 0 20px;color:#374151">Your instructor has <strong>approved</strong> your work. Nothing further is needed.</p>`
    : `<p style="margin:0 0 12px;color:#374151">Your instructor has sent your work back for a revision.</p>
       <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#FEF2F2;border-radius:12px;padding:16px;width:100%;border:1px solid #FECACA">
         <tr><td style="font-size:14px;color:#374151"><strong>Reason:</strong> ${escapeHtml(reason ?? '')}</td></tr>
       </table>
       <p style="margin:0 0 20px;color:#374151">Open the Assignments section to send a revision — your original submission is still there.</p>`
  const html = wrap(subject, `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0D0F1A">${approved ? 'Assignment approved' : 'Assignment sent back'}</h2>
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${escapeHtml(studentName)}</strong>,</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#F4F5F8;border-radius:12px;padding:16px;width:100%;border:1px solid #E5E7EB">
      <tr><td style="font-size:14px;color:#374151;padding:6px 0"><strong>Class:</strong> ${escapeHtml(sessionTitle)}</td></tr>
      <tr><td style="font-size:14px;color:#374151;padding:6px 0;border-top:1px solid #E5E7EB"><strong>Assignment:</strong> ${escapeHtml(assignmentTitle)}</td></tr>
    </table>
    ${body}
    <p style="margin:0;color:#374151"><strong>Delta Academy</strong></p>
  `)
  await sender.send({
    to, subject, html,
    text: `Dear ${studentName},\n\nClass: ${sessionTitle}\nAssignment: ${assignmentTitle}\n\n${approved ? 'Your instructor has approved your work. Nothing further is needed.' : `Your instructor has sent your work back for a revision.\n\nReason: ${reason ?? ''}\n\nOpen the Assignments section to send a revision.`}\n\nDelta Academy`,
  })
}
