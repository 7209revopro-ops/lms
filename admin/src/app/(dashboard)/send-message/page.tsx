'use client'

/* ─────────────────────────────────────────────────────────────
   Send message — a WhatsApp template and/or an email to a course's students
   (?courseId=) or a live session's booked students (?liveClassId=).
   Preview first (who, how many, the message as the first student sees it),
   then confirm with the count. Admin / super admin; below super admin only
   their own academy's students (the server decides).
───────────────────────────────────────────────────────────── */
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Send, MessageCircle, Mail, Users, AlertCircle, CheckCircle2, Eye } from 'lucide-react'
import { api } from '@/lib/axios'
import { useCourses } from '@/lib/api/courses'
import { useCourseOutline } from '@/lib/api/outline'
import { useOrganizations } from '@/lib/api/organizations'
import { useCurrentUser } from '@/lib/api/user'
import { useSendableTemplates, previewBroadcast, useSendBroadcast, type BroadcastInput, type BroadcastPreview } from '@/lib/api/broadcast'
import Spinner from '@/components/ui/Spinner'

const TOKENS_COURSE = ['{name}', '{course}']
const TOKENS_SESSION = ['{name}', '{course}', '{class}', '{day}', '{time}', '{when}', '{mentor}']

const card = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' } as const
const field = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none placeholder:text-white/30'
const fieldStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', colorScheme: 'dark' } as const
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-widest'
const muted = { color: 'rgba(255,255,255,0.4)' }

const errorOf = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Something went wrong.'

function SendMessage() {
  const sp = useSearchParams()
  const liveClassId = sp.get('liveClassId') ?? ''
  const [courseId, setCourseId] = useState(sp.get('courseId') ?? '')
  const audience = liveClassId ? 'session' : 'course'

  const { data: me } = useCurrentUser()
  const isSuper = me?.role === 'super_admin'
  const { data: orgs = [] } = useOrganizations(isSuper)
  const { data: coursesData } = useCourses({ per_page: 200 })
  const courses = coursesData?.docs ?? []
  const { data: live } = useQuery({
    queryKey: ['admin', 'live-class', liveClassId],
    enabled: !!liveClassId,
    queryFn: async () => (await api.get<{ success: true; data: { id: string; title: string; scheduledStart: string; courseId: any } }>(`/admin/live-classes/${liveClassId}`)).data.data,
  })
  const { data: outline } = useCourseOutline(audience === 'course' ? courseId : '')
  const { data: templates = [] } = useSendableTemplates(audience)

  const [orgId, setOrgId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [useWa, setUseWa] = useState(true)
  const [useEmail, setUseEmail] = useState(false)
  const [template, setTemplate] = useState('')
  const [values, setValues] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<BroadcastPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [done, setDone] = useState<{ whatsapp: number; email: number } | null>(null)
  const send = useSendBroadcast()

  const tpl = templates.find(t => t.name === template)
  /* Pick the first template, and reset its values when it changes. */
  useEffect(() => { if (!template && templates[0]) setTemplate(templates[0].name) }, [templates, template])
  useEffect(() => { if (tpl) setValues(tpl.defaults) }, [tpl?.name])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!subject) setSubject(audience === 'session' ? 'About your class {class}' : 'An update about {course}')
    if (!body) setBody('Hi {name},\n\n')
  }, [audience])  // eslint-disable-line react-hooks/exhaustive-deps

  const input: BroadcastInput = useMemo(() => ({
    audience,
    ...(audience === 'session' ? { liveClassId } : { courseId }),
    ...(audience === 'course' && orgId ? { organizationId: orgId } : {}),
    ...(audience === 'course' && sectionId ? { sectionId } : {}),
    ...(useWa && template ? { whatsapp: { template, values } } : {}),
    ...(useEmail ? { email: { subject, body } } : {}),
  }), [audience, liveClassId, courseId, orgId, sectionId, useWa, template, values, useEmail, subject, body])
  /* Any change invalidates the preview: what was confirmed is what is sent. */
  useEffect(() => { setPreview(null); setConfirm(false) }, [input])

  const runPreview = async () => {
    setError(null); setPreviewing(true)
    try { setPreview(await previewBroadcast(input)) } catch (e) { setError(errorOf(e)) } finally { setPreviewing(false) }
  }
  const runSend = async () => {
    setError(null)
    try { const r = await send.mutateAsync(input); setDone({ whatsapp: r.whatsapp, email: r.email }); setConfirm(false) } catch (e) { setError(errorOf(e)) }
  }

  const tokens = audience === 'session' ? TOKENS_SESSION : TOKENS_COURSE
  const target = audience === 'session'
    ? (live ? `${live.title} — ${new Date(live.scheduledStart).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Loading…')
    : null
  const willReach = preview ? Math.max(preview.whatsapp?.willSend ?? 0, preview.email?.willSend ?? 0) : 0

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl p-8 text-center" style={card}>
        <CheckCircle2 size={32} className="mx-auto" style={{ color: '#4ADE80' }} />
        <p className="mt-3 text-lg font-bold text-white">Sending</p>
        <p className="mt-1 text-sm" style={muted}>
          {done.whatsapp ? `${done.whatsapp} WhatsApp` : ''}{done.whatsapp && done.email ? ' and ' : ''}{done.email ? `${done.email} email` : ''} message(s) are going out now.
          Follow them on WhatsApp Logs and Email Logs.
        </p>
        <button onClick={() => { setDone(null); setPreview(null) }} className="mt-5 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: '#2F6BFF' }}>Send another</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(47,107,255,0.18)', border: '1px solid rgba(47,107,255,0.3)' }}>
            <Send size={15} style={{ color: '#60A5FA' }} />
          </div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Send message</h1>
        </div>
        <p className="mt-1 text-sm" style={muted}>
          {audience === 'session' ? 'To the students booked on this live session.' : "To a course's active students."} WhatsApp uses an approved template; email is your own text.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {/* Who */}
          <div className="space-y-4 rounded-2xl p-5" style={card}>
            <p className="flex items-center gap-2 text-sm font-semibold text-white"><Users size={14} />Who</p>
            {audience === 'session' ? (
              <p className="text-sm text-white">Booked students of <b>{target}</b></p>
            ) : (
              <>
                <div>
                  <label className={label} style={muted}>Course</label>
                  <select value={courseId} onChange={e => { setCourseId(e.target.value); setSectionId('') }} className={field} style={fieldStyle}>
                    <option value="">Select a course…</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.title}{(c as any).sharedAcademies ? ' · Both academies' : ''}</option>)}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {isSuper && (
                    <div>
                      <label className={label} style={muted}>Academy</label>
                      <select value={orgId} onChange={e => setOrgId(e.target.value)} className={field} style={fieldStyle}>
                        <option value="">Every academy</option>
                        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className={label} style={muted}>Only students with this module open</label>
                    <select value={sectionId} onChange={e => setSectionId(e.target.value)} className={field} style={fieldStyle} disabled={!courseId}>
                      <option value="">Any module</option>
                      {(outline?.sections ?? []).map((s: any) => <option key={s.id ?? s._id} value={s.id ?? s._id}>{s.title}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* WhatsApp */}
          <div className="space-y-4 rounded-2xl p-5" style={card}>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
              <input type="checkbox" checked={useWa} onChange={e => setUseWa(e.target.checked)} /><MessageCircle size={14} style={{ color: '#4ADE80' }} />WhatsApp
            </label>
            {useWa && (
              <>
                <div>
                  <label className={label} style={muted}>Template</label>
                  <select value={template} onChange={e => setTemplate(e.target.value)} className={field} style={fieldStyle}>
                    {templates.map(t => <option key={t.name} value={t.name}>{t.label} ({t.name})</option>)}
                  </select>
                  {tpl?.note && <p className="mt-1 text-[11px]" style={muted}>{tpl.note}</p>}
                </div>
                {tpl?.body && (
                  <pre className="whitespace-pre-wrap rounded-xl p-3 text-[12px]" style={{ background: 'rgba(0,0,0,0.25)', color: 'rgba(255,255,255,0.6)', fontFamily: 'inherit' }}>{tpl.body}</pre>
                )}
                {tpl?.params.map((p, i) => (
                  <div key={i}>
                    <label className={label} style={muted}>{`{{${i + 1}}}`} {p}</label>
                    {p === 'Message' ? (
                      <textarea value={values[i] ?? ''} onChange={e => setValues(v => v.map((x, j) => j === i ? e.target.value : x))} rows={3} maxLength={900}
                        className={field} style={fieldStyle} placeholder="Write the update — one paragraph (WhatsApp joins lines)" />
                    ) : (
                      <input value={values[i] ?? ''} onChange={e => setValues(v => v.map((x, j) => j === i ? e.target.value : x))} className={field} style={fieldStyle} />
                    )}
                  </div>
                ))}
                {tpl?.button && <p className="text-[11px]" style={muted}>Button: each student's own {tpl.button === 'join' ? 'one-tap join link' : 'one-tap sign-in link'}.</p>}
              </>
            )}
          </div>

          {/* Email */}
          <div className="space-y-4 rounded-2xl p-5" style={card}>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
              <input type="checkbox" checked={useEmail} onChange={e => setUseEmail(e.target.checked)} /><Mail size={14} style={{ color: '#60A5FA' }} />Email
            </label>
            {useEmail && (
              <>
                <div>
                  <label className={label} style={muted}>Subject</label>
                  <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} className={field} style={fieldStyle} />
                </div>
                <div>
                  <label className={label} style={muted}>Message</label>
                  <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} maxLength={10000} className={field} style={fieldStyle} />
                  <p className="mt-1 text-[11px]" style={muted}>A blank line starts a new paragraph. A button to {audience === 'session' ? 'the class' : 'the course'} (their own sign-in link) is added at the end.</p>
                </div>
              </>
            )}
          </div>

          <p className="text-[11px]" style={muted}>Filled in per student: {tokens.join('  ')}</p>
        </div>

        {/* Preview + send */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="space-y-3 rounded-2xl p-5" style={card}>
            <button onClick={runPreview} disabled={previewing || (audience === 'course' && !courseId) || (!useWa && !useEmail)}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
              {previewing ? <Spinner size={14} /> : <Eye size={14} />}Preview
            </button>
            {error && <p className="flex items-start gap-1.5 text-xs" style={{ color: '#F87171' }}><AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{error}</p>}
            {preview && (
              <div className="space-y-3 text-xs">
                <p className="text-sm font-semibold text-white">{preview.total} student{preview.total === 1 ? '' : 's'}</p>
                {preview.whatsapp && <p style={muted}>WhatsApp: <b className="text-white">{preview.whatsapp.willSend}</b> · no phone {preview.whatsapp.noPhone}</p>}
                {preview.email && <p style={muted}>Email: <b className="text-white">{preview.email.willSend}</b> · no email {preview.email.noEmail}</p>}
                {preview.names.length > 0 && <p style={muted}>{preview.names.join(', ')}{preview.total > preview.names.length ? ` and ${preview.total - preview.names.length} more` : ''}</p>}
                {preview.sample?.whatsapp && (
                  <div className="rounded-xl p-3" style={{ background: '#0B141A' }}>
                    <p className="mb-1 text-[10px]" style={muted}>WhatsApp to {preview.sample.name}</p>
                    <p className="whitespace-pre-wrap rounded-xl px-3 py-2 text-[12px]" style={{ background: '#1F2C33', color: '#E9EDEF' }}>
                      {preview.sample.whatsapp.text?.replace(/\*([^*]+)\*/g, '$1') ?? preview.sample.whatsapp.values.map(v => `${v.name}: ${v.value}`).join('\n')}
                    </p>
                  </div>
                )}
                {preview.sample?.email && (
                  <div className="rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.25)' }}>
                    <p className="mb-1 text-[10px]" style={muted}>Email to {preview.sample.name}</p>
                    <p className="font-semibold text-white">{preview.sample.email.subject}</p>
                    <p className="mt-1 whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.7)' }}>{preview.sample.email.body}</p>
                  </div>
                )}
                {willReach > 0 && !confirm && (
                  <button onClick={() => setConfirm(true)} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: '#2F6BFF' }}>
                    <Send size={14} />Send to {preview.total} student{preview.total === 1 ? '' : 's'}
                  </button>
                )}
                {confirm && (
                  <div className="space-y-2 rounded-xl p-3" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                    <p className="text-xs text-white">Send now? This cannot be recalled.</p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirm(false)} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ background: 'rgba(255,255,255,0.08)' }}>Cancel</button>
                      <button onClick={runSend} disabled={send.isPending} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: '#2F6BFF' }}>
                        {send.isPending ? <Spinner size={12} /> : <Send size={12} />}Yes, send
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SendMessagePage() {
  return <Suspense fallback={<div className="py-16 text-center"><Spinner size={18} /></div>}><SendMessage /></Suspense>
}
