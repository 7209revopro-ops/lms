import { useEffect, useState } from 'react'
import { Appearance } from 'react-native'
import * as SecureStore from 'expo-secure-store'

/* The student's appearance choice — the website's light / dark / system
   toggle. Applied through Appearance.setColorScheme, so every useColorScheme
   (and with it useTheme, the status bar and native pickers) follows without
   a context. Kept on the device; nothing secret, but SecureStore is the
   store this app already has. */

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'lms.pref.theme'
const listeners = new Set<(p: ThemePref) => void>()
let current: ThemePref = 'system'

function apply(p: ThemePref) {
  Appearance.setColorScheme(p === 'system' ? 'unspecified' : p)
}

/** At launch: put the saved choice back before the first screen draws. */
export async function restoreThemePref(): Promise<void> {
  try {
    const saved = await SecureStore.getItemAsync(KEY)
    if (saved === 'light' || saved === 'dark') { current = saved; apply(saved) }
  } catch { /* no saved choice: follow the phone */ }
}

export async function setThemePref(p: ThemePref): Promise<void> {
  current = p
  apply(p)
  listeners.forEach(l => l(p))
  try { await SecureStore.setItemAsync(KEY, p) } catch { /* applied for this session anyway */ }
}

export function useThemePref(): ThemePref {
  const [p, setP] = useState(current)
  useEffect(() => {
    listeners.add(setP)
    return () => { listeners.delete(setP) }
  }, [])
  return p
}
