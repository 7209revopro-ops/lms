import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id:    string
  kind:  ToastKind
  title: string
  body?: string
  /** Optional: clicking the toast opens this page. */
  href?: string
}

interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar:    () => void
  setSidebar:       (v: boolean) => void
  mobileNavOpen:    boolean
  setMobileNav:     (v: boolean) => void

  deleteModalOpen:  boolean
  deleteTargetId:   string | null
  deleteTargetName: string | null
  openDeleteModal:  (id: string, name: string) => void
  closeDeleteModal: () => void

  toasts:    Toast[]
  pushToast: (t: Omit<Toast, 'id'>) => void
  popToast:  (id: string) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar:    () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebar:       (v) => set({ sidebarCollapsed: v }),
      mobileNavOpen:    false,
      setMobileNav:     (v) => set({ mobileNavOpen: v }),

      deleteModalOpen:  false,
      deleteTargetId:   null,
      deleteTargetName: null,
      openDeleteModal:  (id, name) => set({ deleteModalOpen: true, deleteTargetId: id, deleteTargetName: name }),
      closeDeleteModal: () => set({ deleteModalOpen: false, deleteTargetId: null, deleteTargetName: null }),

      toasts:    [],
      pushToast: (t) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        set(s => ({ toasts: [...s.toasts, { ...t, id }] }))
      },
      popToast:  (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
    }),
    { name: 'lms-admin-ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }) },
  ),
)

/* Sugar for components: useToast().success("...") */
export function useToast() {
  const push = useUIStore(s => s.pushToast)
  return {
    success: (title: string, body?: string) => push({ kind: 'success', title, body }),
    error:   (title: string, body?: string) => push({ kind: 'error',   title, body }),
    info:    (title: string, body?: string, href?: string) => push({ kind: 'info', title, body, href }),
  }
}
