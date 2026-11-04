'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import Spinner from '@/components/ui/Spinner'
import { WalletView } from '@/components/wallet/WalletView'
import { useWallet, walletThisMonth } from '@/lib/api/wallet'

/* My Wallet (2026-11-04) — the same wallet as in the HRMS: salary a day at a time, what came off and why, your
   commission, and what finance has paid you. Your own only; a month at a time, back as far as you've been employed. */

const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1 + by, 1)).toISOString().slice(0, 7)
}
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export default function WalletPage() {
  const [month, setMonth] = useState(walletThisMonth)
  const { data: w, isLoading, isFetching, error } = useWallet(month)
  const first = w?.firstMonth ?? shift(walletThisMonth(), -12)
  const message = (error as { response?: { data?: { error?: { message?: string } } } } | null)?.response?.data?.error?.message
  const arrow = 'flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.06] disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div>
      <PageHeader
        title="My Wallet"
        subtitle="Your pay a day at a time — what came off and why, your commission, and what finance has paid you"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
              <button type="button" className={arrow} aria-label="Previous month" disabled={month <= first} onClick={() => setMonth(m => shift(m, -1))}>
                <ChevronLeft size={16} className="text-white" />
              </button>
              <span className="min-w-[8.5rem] text-center text-sm font-medium text-white">{monthLabel(month)}</span>
              <button type="button" className={arrow} aria-label="Next month" disabled={month >= walletThisMonth()} onClick={() => setMonth(m => shift(m, 1))}>
                <ChevronRight size={16} className="text-white" />
              </button>
            </div>
            {isFetching && !isLoading && <Spinner size={14} />}
          </div>
        }
      />
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={22} /></div>
      ) : error || !w ? (
        <div className="rounded-2xl p-6 text-center text-sm" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>
          {message ?? "Your wallet couldn't be loaded. Try again in a moment."}
        </div>
      ) : (
        <WalletView w={w} />
      )}
    </div>
  )
}
