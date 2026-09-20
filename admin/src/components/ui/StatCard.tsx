'use client'

import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label:      string
  value:      string | number
  change?:    number          // percent, positive = up
  changeLabel?: string
  icon:       LucideIcon
  color?:     string          // hex accent
  delay?:     number
  prefix?:    string
  suffix?:    string
}

export function StatCard({ label, value, change, changeLabel, icon: Icon, color = '#0057b8', delay = 0, prefix = '', suffix = '' }: StatCardProps) {
  const up      = change != null && change > 0
  const down    = change != null && change < 0
  const neutral = change == null || change === 0

  return (
    <motion.div
      /* Entry spring and delay inside `animate`, so they do not become the
         default for whileHover as well - the fourth card was taking 150ms to
         begin lifting. */
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 24, delay } }}
      whileHover={{ y: -3, boxShadow: `0 16px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.07)` }}
      className="relative overflow-hidden rounded-2xl p-5 cursor-default"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* Subtle glow behind icon */}
      {/* <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full opacity-20 blur-2xl"
        style={{ background: color }} /> */}

      <div className="relative z-10">
        {/* Icon + label */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: `${color}18`, border: `1px solid ${color}28` }}>
            <Icon size={18} style={{ color }} strokeWidth={1.8} />
          </div>
          {change != null && (
            <div className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold`}
              style={{
                background: up ? 'rgba(34,197,94,0.12)' : down ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)',
                color: up ? '#4ADE80' : down ? '#F87171' : 'rgba(255,255,255,0.4)',
              }}>
              {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : <Minus size={11} />}
              {change > 0 ? '+' : ''}{change}%
            </div>
          )}
        </div>

        {/* Value */}
        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.1 }}
          className="text-3xl font-bold tracking-tight text-white"
          style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
        </motion.p>

        {/* Label + change text */}
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
        {changeLabel && (
          <p className="mt-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{changeLabel}</p>
        )}
      </div>
    </motion.div>
  )
}
