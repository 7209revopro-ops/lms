'use client'

import { ShieldAlert } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { categoryScopeOf } from '@/lib/programScope'

/* A sub-admin with no department reaches nothing: the backend refuses every
   request with NO_DEPARTMENT (plan.md §10, rule R2 — fail closed). Without
   this notice the panel would just be a wall of empty tables and error
   toasts with no hint why. */
export function NoDepartmentNotice() {
  const { data: me } = useCurrentUser()
  if (!me || me.role !== 'sub_admin' || categoryScopeOf(me)) return null
  return (
    <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm"
      style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#FCA5A5' }}>
      <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" />
      <div>
        <p className="font-semibold text-white">Your account is not assigned to a department yet.</p>
        <p className="mt-0.5">
          Sub-admins see only their own department&apos;s data, so nothing can be shown until an
          administrator sets your department (FOREX, Digital Marketing, AI or JURA).
        </p>
      </div>
    </div>
  )
}
