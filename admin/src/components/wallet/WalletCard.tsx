'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowUpRight, WalletCards } from 'lucide-react'
import { useWallet, walletThisMonth } from '@/lib/api/wallet'

/*
 * The wallet on the dashboard, first in its row (2026-11-04): this month so far from the HRMS — earned, deducted,
 * paid — and a way into My Wallet. Nothing when there is no wallet to show (no HRMS record, not linked, signed in as
 * someone else): the dashboard is not where to say why.
 */

const money = (n: number, c: string) => `${c} ${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function WalletCard() {
  const { data: w } = useWallet(walletThisMonth())
  if (!w) return null
  const c = w.currency
  const [label, figure] =
    w.status === 'paid' ? ['Paid in full', w.totals.paid]
    : w.status === 'payslip' || w.status === 'part_paid' ? ['Still to be paid', w.totals.balance]
    : ['Earned so far this month', w.totals.net]
  const lost = w.days.filter(d => d.counted).flatMap(d => d.deductions).reduce((s, x) => s + x.days, 0)
  return (
    <Link href="/wallet" className="block">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -3, boxShadow: '0 16px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.07)' }}
        className="rounded-2xl p-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: '#0057b818', border: '1px solid #0057b828' }}>
              <WalletCards size={18} style={{ color: '#60A5FA' }} strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>My wallet · {String(label).toLowerCase()}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums text-white">{w.status === 'paused' ? '—' : money(Number(figure), c)}</p>
            </div>
          </div>
          <ArrowUpRight size={16} style={{ color: 'rgba(255,255,255,0.4)' }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div><p style={{ color: 'rgba(255,255,255,0.4)' }}>Credited</p><p className="font-semibold tabular-nums" style={{ color: '#4ADE80' }}>+{money(w.totals.credited, c)}</p></div>
          <div><p style={{ color: 'rgba(255,255,255,0.4)' }}>Deducted</p><p className="font-semibold tabular-nums" style={{ color: '#F87171' }}>−{money(w.totals.deducted, c)}</p></div>
          <div><p style={{ color: 'rgba(255,255,255,0.4)' }}>Paid</p><p className="font-semibold tabular-nums text-white">{money(w.totals.paid, c)}</p></div>
        </div>
        {lost > 0 && <p className="mt-2 text-xs" style={{ color: '#F87171' }}>{lost} day{lost === 1 ? '' : 's'} of pay lost this month — see why</p>}
      </motion.div>
    </Link>
  )
}
