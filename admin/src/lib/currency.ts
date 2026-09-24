'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'
import { useOrgStore } from '@/store/org.store'
import { useOrganizations } from '@/lib/api/organizations'
import { useCurrentUser } from '@/lib/api/user'

/* ─────────────────────────────────────────────────────
   Which currency does THIS admin panel work in?

   Bangalore is an INR academy and Dubai an AED one, but the panel showed
   `$<price>` — the USD base — to everyone, so neither admin was looking at
   the amount their students actually pay.

   Resolution order:
     1. super_admin with an academy picked in the switcher → that academy.
     2. super_admin on "All Orgs" → base USD, because no single currency is
        correct for a list spanning both.
     3. everyone else → their own academy, from /admin/my-organization
        (/admin/organizations is super_admin-only, so a Bangalore admin could
        not otherwise discover their own currency).
───────────────────────────────────────────────────── */

export interface OrgCurrency {
  code:         'AED' | 'INR' | 'USD'
  symbol:       string
  /** Multiplier from the USD base price. 1 when already USD. */
  exchangeRate: number
  /** Academy name, for "showing X prices" hints. */
  orgName?:     string
}

interface MyOrg {
  id: string; name: string; slug: string
  currency: 'AED' | 'INR'; exchangeRate: number
}

const SYMBOL: Record<OrgCurrency['code'], string> = {
  AED: 'AED ',
  INR: '₹',
  USD: '$',
}

const BASE: OrgCurrency = { code: 'USD', symbol: '$', exchangeRate: 1 }

export function useMyOrganization(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'my-organization'],
    queryFn:  () => apiGet<MyOrg | null>('/admin/my-organization'),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useOrgCurrency(): OrgCurrency {
  const { data: user }   = useCurrentUser()
  const activeOrgId      = useOrgStore(s => s.activeOrgId)
  const isSuper          = user?.role === 'super_admin'

  /* Only a super admin can list every academy; asking as anyone else is a
     guaranteed 403, so the query is disabled for them. */
  const { data: orgs }   = useOrganizations(isSuper)
  const { data: myOrg }  = useMyOrganization()

  return useMemo(() => {
    if (isSuper) {
      if (!activeOrgId) return BASE            // "All Orgs" — no single currency applies
      const org = (orgs ?? []).find(o => o.id === activeOrgId)
      if (!org) return BASE
      return { code: org.currency, symbol: SYMBOL[org.currency], exchangeRate: org.exchangeRate ?? 1, orgName: org.name }
    }
    if (myOrg) {
      return { code: myOrg.currency, symbol: SYMBOL[myOrg.currency], exchangeRate: myOrg.exchangeRate ?? 1, orgName: myOrg.name }
    }
    return BASE
  }, [isSuper, activeOrgId, orgs, myOrg])
}

/* ── Price of a course in the panel's currency ─────────
   Mirrors the backend's aedPriceFor / inrPriceFor exactly, including the
   rounding: a per-course override wins, otherwise the USD base is converted
   at the same env rate checkout uses. Matching matters — an admin quoting a
   figure the gateway then charges differently is worse than showing USD. */
export function priceIn(
  course: { price: number; priceAED?: number; priceINR?: number; isFree?: boolean },
  cur: OrgCurrency,
): number {
  if (cur.code === 'AED') {
    return course.priceAED ?? Math.round(course.price * cur.exchangeRate * 100) / 100
  }
  if (cur.code === 'INR') {
    return course.priceINR ?? Math.round(course.price * cur.exchangeRate)
  }
  return course.price
}

/** Formatted for display — "Free" when the course is free. */
export function formatCoursePrice(
  course: { price: number; priceAED?: number; priceINR?: number; isFree?: boolean },
  cur: OrgCurrency,
): string {
  if (course.isFree || course.price <= 0) return 'Free'
  const value = priceIn(course, cur)
  /* INR is quoted whole; AED and USD to two places, matching each gateway. */
  const shown = cur.code === 'INR'
    ? value.toLocaleString('en-IN')
    : value.toFixed(2)
  return `${cur.symbol}${shown}`
}

/** Any money already expressed in the panel's currency (totals, revenue). */
export function formatMoney(value: number, cur: OrgCurrency): string {
  const shown = cur.code === 'INR' ? Math.round(value).toLocaleString('en-IN') : value.toFixed(2)
  return `${cur.symbol}${shown}`
}
