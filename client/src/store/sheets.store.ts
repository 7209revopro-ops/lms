'use client'
/* Which app-wide sheet is open — so the bottom tab bar and the "what you
   missed" popup can both open the notifications drawer. Not persisted. */
import { create } from 'zustand'

interface SheetsState {
  notificationsOpen: boolean
  setNotificationsOpen: (v: boolean) => void
}
export const useSheets = create<SheetsState>()(set => ({
  notificationsOpen: false,
  setNotificationsOpen: v => set({ notificationsOpen: v }),
}))
