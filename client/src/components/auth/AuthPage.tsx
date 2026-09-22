'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AuthHeroPanel } from './AuthHeroPanel'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'

type AuthMode = 'login' | 'register'

interface AuthPageProps {
  initialMode: AuthMode
  /** Offer Full Registration only — derived from `?flow=full` by both
      app/(auth)/register/page.tsx and app/(auth)/login/page.tsx. */
  lockFull?: boolean
}

function StepDots({ mode }: { mode: AuthMode }) {
  return (
    <div className="flex items-center gap-1.5">
      {(['login', 'register'] as const).map(m => (
        <motion.div
          key={m}
          animate={{ width: mode === m ? 22 : 6, opacity: mode === m ? 1 : 0.28 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          className="h-1.5 rounded-full"
          style={{ background: '#1452BE' }}
        />
      ))}
    </div>
  )
}

export function AuthPage({ initialMode, lockFull = false }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode)

  const switchMode = (next: AuthMode) => {
    setMode(next)
    /* Carry the lock, and only the lock. `?flow=full` has to survive a hop
       to Sign in and back, or a reload after it lands on a plain URL and the
       Express tab this link exists to hide is back. Nothing else is carried:
       `?from`, `?method=email` and `?session=expired` were always dropped
       on a hop, and LoginForm / middleware read them from the live URL, so
       carrying them would change what a hop does for everyone else. */
    window.history.replaceState(null, '', (next === 'login' ? '/login' : '/register') + (lockFull ? '?flow=full' : ''))
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">

      {/* ── LEFT hero panel (55%) ── */}
      <motion.div
        className="relative hidden h-full lg:flex"
        style={{ width: '55%', flexShrink: 0 }}
        initial={{ x: '-100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 30, delay: 0.05 }}
      >
        <AuthHeroPanel />
      </motion.div>

      {/* ── RIGHT form panel (45%) ── */}
      <motion.div
        className="relative flex h-full w-full flex-col overflow-y-auto lg:w-[45%]"
        style={{ background: '#F5F7FA' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.12 }}
      >
        {/* Left-edge depth shadow */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-6 lg:block"
          style={{ background: 'rgba(0,0,0,0.04)' }}
        />

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between px-8 py-6 lg:px-12">
          {/* Mobile logo */}
          <div className="flex items-center lg:hidden">
            <div
              className="flex items-center justify-center rounded-xl px-3 py-1.5"
              style={{ background: '#1452BE' }}
            >
              <img src="/logo.png" alt="Delta" className="h-7 w-auto object-contain" />
            </div>
          </div>

          {/* spacer on desktop */}
          <div className="hidden lg:block" />

          {/* Toggle buttons */}
          <div className="flex items-center gap-2">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className="min-h-[44px] rounded-lg px-5 text-sm font-semibold transition-all sm:min-h-0 sm:py-2"
                style={
                  mode === m
                    ? {
                        background: 'var(--color-bg-surface)',
                        color: '#1452BE',
                        border: '1.5px solid #1452BE',
                        boxShadow: '0 1px 4px rgba(20,82,190,0.12)',
                      }
                    : {
                        background: 'transparent',
                        color: 'var(--color-text-muted)',
                        border: '1.5px solid var(--color-border)',
                      }
                }
              >
                {m === 'login' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Form area ── */}
        <div className="flex flex-1 items-center justify-center px-8 py-6 lg:px-16">
          <div className="w-full max-w-[400px]">

            {/* Step dots — the progress and its caption belong together, so
                they are centred as ONE group. `justify-between` pinned the
                dots hard left and the caption hard right, which read as two
                unrelated fragments floating above the form rather than a
                single wizard indicator. */}
            <div className="mb-6 flex items-center justify-center gap-3">
              <StepDots mode={mode} />
              <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                {mode === 'login' ? 'Step 1 of 1' : 'Step 1 of 2'}
              </span>
            </div>

            <AnimatePresence mode="wait">
              {mode === 'login' ? (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  <LoginForm onSwitch={() => switchMode('register')} />
                </motion.div>
              ) : (
                <motion.div
                  key="register"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  <RegisterForm onSwitch={() => switchMode('login')} lockFull={lockFull} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-8 py-5 lg:px-12">
          <p className="text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
            © {new Date().getFullYear()} Delta Institutions · All rights reserved ·{' '}
            <span className="cursor-pointer transition-colors hover:text-[var(--color-text-muted)]">Privacy</span>
            {' · '}
            <span className="cursor-pointer transition-colors hover:text-[var(--color-text-muted)]">Terms</span>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
