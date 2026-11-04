'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'
import type { Wallet } from '@/types/wallet'

/* My Wallet (2026-11-04): the staff member's own month from the HRMS — salary a day at a time, what came off and
   why, commission, what finance has paid (GET /admin/wallet/me). Never somebody else's. */
export function useWallet(month: string) {
  return useQuery({
    queryKey: ['admin', 'wallet', month],
    queryFn: () => apiGet<Wallet>('/admin/wallet/me', { month }),
    // Finance is asked behind it on every load; a minute keeps flicking between months cheap.
    staleTime: 60_000,
    retry: false,
  })
}

/** This month where the company keeps its books. */
export const walletThisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()).slice(0, 7)
