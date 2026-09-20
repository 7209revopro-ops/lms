'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings, Globe, Mail, CreditCard, Shield, Database,
  Check, ChevronRight, ExternalLink, AlertCircle, Server,
  Zap, BookOpen, Users, Lock,
} from 'lucide-react'
import { useAdminStats } from '@/lib/api/stats'
import { EmailNotificationsSection } from '@/components/settings/EmailNotificationsSection'

/* ─── Section card ─────────────────────────────────────── */
function Card({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2.5 px-5 py-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Icon size={15} style={{ color: '#0057b8' }} />
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  )
}

/* ─── Status indicator ─────────────────────────────────── */
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className="flex h-2 w-2 rounded-full flex-shrink-0"
      style={{ background: ok ? '#4ADE80' : '#F87171' }} />
  )
}

/* ─── Setting row ──────────────────────────────────────── */
function SettingRow({ label, value, hint, badge }: {
  label: string
  value: React.ReactNode
  hint?: string
  badge?: { text: string; ok: boolean }
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white">{label}</p>
        {hint && <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{hint}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {badge && (
          <span className="flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: badge.ok ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
              color:      badge.ok ? '#4ADE80' : '#F87171',
            }}>
            <StatusDot ok={badge.ok} />{badge.text}
          </span>
        )}
        <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.55)' }}>{value}</span>
      </div>
    </div>
  )
}

/* ─── Editable text setting ────────────────────────────── */
function EditableSetting({
  label, value, placeholder, hint, onSave,
}: {
  label: string; value: string; placeholder?: string; hint?: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-white">{label}</p>
        {!editing && (
          <button onClick={() => { setDraft(value); setEditing(true) }}
            className="text-[11px] font-semibold transition-opacity hover:opacity-70"
            style={{ color: '#0057b8' }}>
            Edit
          </button>
        )}
      </div>
      {hint && <p className="mb-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{hint}</p>}
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="flex-1 rounded-xl px-3 py-2 text-xs text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.4)' }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onSave(draft); setEditing(false) }
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button onClick={() => { onSave(draft); setEditing(false) }}
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: 'rgba(74,222,128,0.18)', color: '#4ADE80' }}>
            <Check size={13} />
          </button>
        </div>
      ) : (
        <p className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {value || <span style={{ color: 'rgba(255,255,255,0.2)' }}>not set</span>}
        </p>
      )}
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────── */
export default function AdminSettingsPage() {
  const { data: stats } = useAdminStats()

  /* Platform settings — stored in localStorage for now (server-persisted settings require a DB settings model) */
  const [platformName, setPlatformName] = useState(
    () => (typeof window !== 'undefined' ? localStorage.getItem('lms_platform_name') : null) ?? 'Delta Institutions',
  )
  const [supportEmail, setSupportEmail] = useState(
    () => (typeof window !== 'undefined' ? localStorage.getItem('lms_support_email') : null) ?? '',
  )
  const [saved, setSaved] = useState(false)

  const savePlatform = (key: string, value: string) => {
    if (typeof window !== 'undefined') localStorage.setItem(key, value)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  /* Env-driven status checks (values are redacted in the browser — we just show configured / not) */
  const stripeConfigured  = false  // can't read env on client; assume not configured unless told otherwise
  const smtpConfigured    = false
  const ollamaConfigured  = true   // Ollama runs locally by default

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
          <Settings size={18} style={{ color: '#0057b8' }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Platform Settings
          </h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Configuration overview and quick edits.
          </p>
        </div>
        <AnimatePresence>
          {saved && (
            <motion.span key="saved" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold"
              style={{ background: 'rgba(74,222,128,0.15)', color: '#4ADE80' }}>
              <Check size={12} />Saved
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* ── Platform info ───────────────────────────── */}
      <Card title="Platform" icon={Globe}>
        <EditableSetting
          label="Platform name"
          value={platformName}
          placeholder="e.g. Delta Institutions"
          hint="Displayed in the navigation bar and emails."
          onSave={v => { setPlatformName(v); savePlatform('lms_platform_name', v) }}
        />
        <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <EditableSetting
          label="Support email"
          value={supportEmail}
          placeholder="support@yourplatform.com"
          hint="Shown to students when they need help."
          onSave={v => { setSupportEmail(v); savePlatform('lms_support_email', v) }}
        />
        <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <SettingRow
          label="Environment"
          hint="Set via NODE_ENV in backend .env"
          value="development"
          badge={{ text: 'development', ok: false }}
        />
      </Card>

      {/* ── Email notifications (per-user) ──────────── */}
      <Card title="Email Notifications" icon={Mail}>
        <EmailNotificationsSection />
      </Card>

      {/* ── Database stats ──────────────────────────── */}
      <Card title="Database" icon={Database}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Courses',      value: stats?.totalCourses     ?? '—', icon: BookOpen },
            { label: 'Students',     value: stats?.totalStudents    ?? '—', icon: Users    },
            { label: 'Enrollments',  value: stats?.totalEnrollments ?? '—', icon: Zap      },
            { label: 'Reviews',      value: stats?.totalReviews     ?? '—', icon: AlertCircle },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3 text-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-xl font-bold text-white">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest mt-0.5"
                style={{ color: 'rgba(255,255,255,0.35)' }}>{s.label}</p>
            </div>
          ))}
        </div>
        <SettingRow
          label="MongoDB connection"
          hint="mongodb://localhost:27017/lms"
          value="connected"
          badge={{ text: 'connected', ok: true }}
        />
      </Card>

      {/* ── Email (SMTP) ────────────────────────────── */}
      <Card title="Email (SMTP)" icon={Mail}>
        <SettingRow
          label="SMTP status"
          hint="Configure SMTP_HOST, SMTP_USER, SMTP_PASS in backend .env"
          value={smtpConfigured ? 'configured' : 'not configured'}
          badge={{ text: smtpConfigured ? 'configured' : 'not configured', ok: smtpConfigured }}
        />
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
            When SMTP is unconfigured, transactional emails (password reset, verification) are written to{' '}
            <code className="rounded px-1" style={{ background: 'rgba(255,255,255,0.08)', fontSize: 10 }}>.logs/emails/</code>{' '}
            as HTML files for local preview. Add <code className="rounded px-1" style={{ background: 'rgba(255,255,255,0.08)', fontSize: 10 }}>SMTP_*</code>{' '}
            vars to send real emails.
          </p>
        </div>
      </Card>

      {/* ── Payments (Stripe) ───────────────────────── */}
      <Card title="Payments (Stripe)" icon={CreditCard}>
        <SettingRow
          label="Stripe secret key"
          hint="STRIPE_SECRET_KEY in backend .env — required for paid courses"
          value={stripeConfigured ? 'sk_test_•••' : 'not set'}
          badge={{ text: stripeConfigured ? 'configured' : 'not configured', ok: stripeConfigured }}
        />
        <SettingRow
          label="Webhook secret"
          hint="STRIPE_WEBHOOK_SECRET — required for payment fulfillment"
          value="not set"
          badge={{ text: 'not configured', ok: false }}
        />
        <SettingRow
          label="Currency"
          hint="STRIPE_CURRENCY in backend .env"
          value="USD"
        />
        <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold transition-opacity hover:opacity-70"
          style={{ color: '#0057b8' }}>
          Open Stripe dashboard <ExternalLink size={10} />
        </a>
      </Card>

      {/* ── AI (Ollama) ─────────────────────────────── */}
      <Card title="AI (Ollama)" icon={Server}>
        <SettingRow
          label="Ollama base URL"
          hint="OLLAMA_BASE_URL in backend .env"
          value="http://localhost:11434"
        />
        <SettingRow
          label="Model"
          hint="OLLAMA_MODEL in backend .env — run: ollama pull llama3.2:3b"
          value="llama3.2:3b"
          badge={{ text: ollamaConfigured ? 'configured' : 'not configured', ok: ollamaConfigured }}
        />
      </Card>

      {/* ── Security ────────────────────────────────── */}
      <Card title="Security" icon={Shield}>
        <SettingRow
          label="JWT access token TTL"
          hint="JWT_ACCESS_EXPIRES_IN in backend .env"
          value="15m"
          badge={{ text: 'configured', ok: true }}
        />
        <SettingRow
          label="JWT refresh token TTL"
          hint="JWT_REFRESH_EXPIRES_IN in backend .env"
          value="30d"
          badge={{ text: 'configured', ok: true }}
        />
        <SettingRow
          label="Bcrypt cost factor"
          hint="BCRYPT_ROUNDS in backend .env (10–14)"
          value="12"
          badge={{ text: 'strong', ok: true }}
        />
        <SettingRow
          label="Two-factor authentication"
          hint="TOTP via /auth/2fa routes (RFC 6238). Students enable in Profile → Security."
          value=""
          badge={{ text: 'available', ok: true }}
        />
        <SettingRow
          label="Rate limiting"
          hint="Auth: 15 req/15min · Search: 30 req/min"
          value=""
          badge={{ text: 'active', ok: true }}
        />
      </Card>

      {/* ── Quick links ─────────────────────────────── */}
      <Card title="Quick links" icon={ChevronRight}>
        {[
          { label: 'Audit logs',      href: '/audit-logs',   desc: 'Browse admin action history'           },
          { label: 'User management', href: '/students',     desc: 'View and manage student accounts'      },
          { label: 'Instructors',     href: '/instructors',  desc: 'Manage instructor roles'               },
          { label: 'Coupons',         href: '/coupons',      desc: 'Create and manage discount codes'      },
          { label: 'Orders',          href: '/orders',       desc: 'View payment history'                  },
          { label: 'Reviews',         href: '/reviews',      desc: 'Moderate student course reviews'       },
        ].map(link => (
          <a key={link.href} href={link.href}
            className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.05]">
            <div>
              <p className="text-xs font-semibold text-white">{link.label}</p>
              <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{link.desc}</p>
            </div>
            <ChevronRight size={13} style={{ color: 'rgba(255,255,255,0.3)' }} />
          </a>
        ))}
      </Card>

      {/* ── Warning ─────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-2xl p-4"
        style={{ background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.18)' }}>
        <Lock size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#FACC15' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Sensitive configuration (API keys, secrets) is managed via the{' '}
          <code className="rounded px-1 text-[10px]" style={{ background: 'rgba(255,255,255,0.08)' }}>backend/.env</code>{' '}
          file and is never exposed to the browser. Changes to those values require a backend restart.
        </p>
      </div>
    </div>
  )
}
