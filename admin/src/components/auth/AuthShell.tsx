'use client'

import { motion } from 'framer-motion'

/* Shared visual shell for the admin auth screens (login, forgot, reset) so they
   look identical: animated orbs, grid, noise, and the glassmorphism card with
   the Delta logo + Admin badge. Screens render their form as children. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden"
      style={{ background: '#080A12' }}
    >
      {/* ── Animated gradient orbs ─────────────────── */}
      <motion.div className="pointer-events-none absolute rounded-full"
        style={{ width: 600, height: 600, top: '-20%', right: '-15%', background: 'radial-gradient(circle, rgba(0,87,184,0.18) 0%, transparent 70%)', filter: 'blur(60px)' }}
        animate={{ scale: [1, 1.15, 1], x: [0, 24, 0], y: [0, -20, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="pointer-events-none absolute rounded-full"
        style={{ width: 500, height: 500, bottom: '-15%', left: '-12%', background: 'radial-gradient(circle, rgba(47,107,255,0.16) 0%, transparent 70%)', filter: 'blur(72px)' }}
        animate={{ scale: [1, 1.12, 1], x: [0, -18, 0], y: [0, 22, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 2 }} />
      <motion.div className="pointer-events-none absolute rounded-full"
        style={{ width: 380, height: 380, top: '40%', left: '35%', background: 'radial-gradient(circle, rgba(167,139,250,0.10) 0%, transparent 70%)', filter: 'blur(80px)' }}
        animate={{ scale: [1, 1.08, 1], y: [0, 16, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut', delay: 1 }} />

      {/* ── Animated grid ──────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '56px 56px' }} />

      {/* ── Noise ──────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`, backgroundSize: '200px 200px' }} />

      {/* ── Glassmorphism card ──────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        className="relative z-10 w-full max-w-[460px] rounded-3xl p-5 sm:p-10 mx-4"
        style={{
          background: 'rgba(15,18,32,0.80)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8 flex items-center gap-2.5"
        >
          <img src="/logo.png" alt="Delta" style={{ height: 64, width: 'auto', objectFit: 'contain' }} />
          <span className="ml-auto rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={{ background: 'rgba(0,87,184,0.15)', color: '#0057b8', border: '1px solid rgba(0,87,184,0.25)' }}>
            Admin
          </span>
        </motion.div>

        {children}
      </motion.div>

      {/* ── Footer ─────────────────────────────────── */}
      <p className="absolute bottom-6 text-center text-xs" style={{ color: 'rgba(255,255,255,0.15)' }}>
        © {new Date().getFullYear()} Delta Institutions · Admin Portal
      </p>
    </div>
  )
}
