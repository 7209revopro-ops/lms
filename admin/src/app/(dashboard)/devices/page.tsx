'use client'

import { useMemo, useState } from 'react'
import { MonitorSmartphone, Check, X, RotateCcw, ShieldCheck, Lock, Unlock } from 'lucide-react'
import {
  useDevices, useApproveDevice, useRevokeDevice, useDeviceLimit, useSetDeviceLimit,
  type DeviceView,
} from '@/lib/api/devices'
import { useCurrentUser } from '@/lib/api/user'
import { useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const s = Math.floor((Date.now() - then) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString()
}

const STATUS_META: Record<DeviceView['status'], { label: string; color: string; bg: string }> = {
  approved: { label: 'approved', color: '#10B981', bg: 'rgba(16,185,129,0.14)' },
  pending:  { label: 'pending',  color: '#D97706', bg: 'rgba(217,119,6,0.14)'  },
  revoked:  { label: 'revoked',  color: '#6B7280', bg: 'rgba(107,114,128,0.14)' },
}

function StatusBadge({ status, isMain }: { status: DeviceView['status']; isMain: boolean }) {
  const m = STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold capitalize"
        style={{ background: m.bg, color: m.color }}>{m.label}</span>
      {isMain && (
        <span className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: 'rgba(0,87,184,0.12)', color: '#0057b8' }}><ShieldCheck size={9} />main</span>
      )}
    </span>
  )
}

/* The master switch.

   Shown to every admin, operable only by a super admin: the limit is one
   global setting across every academy, so a Dubai admin turning it off would
   be turning it off for Bangalore too. An org admin sees the state and who
   set it, with the control itself disabled and the reason on the tooltip —
   which is more use than hiding it, because the first question an admin asks
   about an empty approval queue is whether the feature is even on.

   The server enforces the same rule; this is the explanation, not the guard. */
function LimitSwitch() {
  const { data: user } = useCurrentUser()
  const { data: state, isLoading } = useDeviceLimit()
  const setLimit = useSetDeviceLimit()
  const toast = useToast()

  const isSuper = user?.role === 'super_admin'
  const enabled = state?.enabled ?? true

  async function flip() {
    if (!isSuper || setLimit.isPending) return
    try {
      const next = await setLimit.mutateAsync(!enabled)
      toast.success(next.enabled
        ? 'Device limit is back on'
        : 'Device limit is off — students can sign in on any device')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      toast.error(msg ?? 'Could not change the setting.')
    }
  }

  if (isLoading) return null

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4"
      style={enabled
        ? { borderColor: 'rgba(16,185,129,0.28)', background: 'rgba(16,185,129,0.05)' }
        : { borderColor: 'rgba(217,119,6,0.35)',  background: 'rgba(217,119,6,0.07)' }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={enabled
            ? { background: 'rgba(16,185,129,0.14)', color: '#10B981' }
            : { background: 'rgba(217,119,6,0.14)',  color: '#D97706' }}>
          {enabled ? <Lock size={15} /> : <Unlock size={15} />}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-white">
            {enabled ? 'Two-device limit is ON' : 'Two-device limit is OFF'}
          </p>
          <p className="mt-0.5 text-[12px] text-gray-500">
            {enabled
              ? 'Students are held to two approved devices. New devices appear below for approval.'
              : 'Students can sign in on any device. Nothing is blocked and no new device requests are recorded.'}
          </p>
          {state?.updatedByName && (
            <p className="mt-1 text-[11px] text-gray-400">
              Last changed by {state.updatedByName}
              {state.updatedAt ? ` · ${timeAgo(state.updatedAt)}` : ''}
            </p>
          )}
          {!isSuper && (
            <p className="mt-1 text-[11px] text-gray-400">
              Only a super admin can change this — it applies to every academy.
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={flip}
        disabled={!isSuper || setLimit.isPending}
        title={isSuper
          ? (enabled ? 'Turn the limit off' : 'Turn the limit back on')
          : 'Only a super admin can change this'}
        aria-pressed={enabled}
        aria-label="Two-device limit"
        className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: enabled ? '#10B981' : '#D1D5DB' }}
      >
        <span
          className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
          style={{ transform: enabled ? 'translateX(26px)' : 'translateX(4px)' }}
        />
      </button>
    </section>
  )
}

export default function DevicesPage() {
  const { data: devices = [], isLoading, isError } = useDevices('all')
  const approve = useApproveDevice()
  const revoke = useRevokeDevice()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const pending = useMemo(() => devices.filter(d => d.status === 'pending'), [devices])
  const approvedByUser = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of devices) if (d.status === 'approved') map.set(d.userId, (map.get(d.userId) ?? 0) + 1)
    return map
  }, [devices])

  async function act(id: string, action: 'approve' | 'revoke') {
    setBusy(id)
    try {
      if (action === 'approve') await approve.mutateAsync(id)
      else await revoke.mutateAsync(id)
      toast.success(action === 'approve' ? 'Device approved' : 'Device revoked')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      toast.error(msg ?? 'Could not update the device.')
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <div className="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
  if (isError) return <div className="p-6 text-[14px] text-red-600">Could not load devices. Try again.</div>

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(0,87,184,0.10)', color: '#0057b8' }}>
          <MonitorSmartphone size={20} />
        </span>
        <div>
          <h1 className="text-[20px] font-bold text-white">Devices</h1>
          <p className="text-[13px] text-gray-500">
            Students may use two devices. The first is auto-approved; a second needs your approval here.
            Revoking a device frees a slot and ends its session within minutes.
          </p>
        </div>
      </div>

      <LimitSwitch />

      {/* Pending requests */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold text-white">
          Pending requests{pending.length ? ` (${pending.length})` : ''}
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-[13px] text-gray-500">
            No devices waiting for approval.
          </div>
        ) : (
          <ul className="flex list-none flex-col gap-2">
            {pending.map(d => {
              const atLimit = (approvedByUser.get(d.userId) ?? 0) >= 2
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
                  style={{ borderColor: 'rgba(217,119,6,0.3)', background: 'rgba(217,119,6,0.04)' }}>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-white">
                      {d.name ?? d.email}
                      {d.phone && <span className="font-normal text-gray-500"> · {d.phone}</span>}
                    </p>
                    <p className="mt-0.5 text-[12px] text-gray-500">
                      {d.email} · {d.label ?? 'Unknown device'}{d.ip ? ` · ${d.ip}` : ''} · requested {timeAgo(d.createdAt)}
                      {atLimit && ' · already has 2 approved'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      disabled={busy === d.id || atLimit}
                      onClick={() => act(d.id, 'approve')}
                      title={atLimit ? 'Revoke one of this student\'s devices first' : undefined}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-white transition disabled:opacity-40"
                      style={{ background: '#10B981' }}>
                      <Check size={14} /> Approve
                    </button>
                    <button
                      disabled={busy === d.id}
                      onClick={() => act(d.id, 'revoke')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-[13px] font-semibold text-gray-600 transition hover:bg-gray-200 disabled:opacity-40">
                      <X size={14} /> Deny
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* All devices */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold text-white">All devices</h2>
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-[13px] text-gray-400">No devices yet.</td></tr>
              ) : devices.map(d => {
                const atLimit = (approvedByUser.get(d.userId) ?? 0) >= 2
                return (
                  <tr key={d.id} className="border-b border-gray-50 last:border-b-0">
                    <td className="px-4 py-3 align-top">
                      <p className="text-[13px] font-medium text-white">{d.name ?? d.email}</p>
                      <p className="text-[12px] text-gray-500">{d.email}{d.phone ? ` · ${d.phone}` : ''}</p>
                    </td>
                    <td className="px-4 py-3 align-top text-[13px] text-gray-700">
                      {d.label ?? 'Unknown device'}
                      {d.ip && <span className="block text-[12px] text-gray-400">{d.ip}</span>}
                    </td>
                    <td className="px-4 py-3 align-top"><StatusBadge status={d.status} isMain={d.isMain} /></td>
                    <td className="px-4 py-3 align-top text-[13px] text-gray-500">{d.lastSeenAt ? timeAgo(d.lastSeenAt) : '—'}</td>
                    <td className="px-4 py-3 text-right align-top">
                      {d.status === 'approved' ? (
                        <button disabled={busy === d.id} onClick={() => act(d.id, 'revoke')}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-3 text-[13px] font-semibold text-gray-600 transition hover:bg-gray-200 disabled:opacity-40">
                          <X size={14} /> Revoke
                        </button>
                      ) : d.status === 'revoked' ? (
                        <button disabled={busy === d.id || atLimit} onClick={() => act(d.id, 'approve')}
                          title={atLimit ? 'Student already has 2 approved devices' : undefined}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-white transition disabled:opacity-40"
                          style={{ background: '#10B981' }}>
                          <RotateCcw size={14} /> Re-approve
                        </button>
                      ) : (
                        <span className="text-[13px] text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
