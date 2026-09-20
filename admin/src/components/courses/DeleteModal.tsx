'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { useUIStore, useToast } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'
import { useDeleteCourse } from '@/lib/api/courses'

export function DeleteModal() {
  const { deleteModalOpen, deleteTargetId, deleteTargetName, closeDeleteModal } = useUIStore()
  const deleteMutation = useDeleteCourse()
  const toast          = useToast()

  const handleConfirm = async () => {
    if (!deleteTargetId) return
    try {
      await deleteMutation.mutateAsync(deleteTargetId)
      closeDeleteModal()
      toast.success('Course deleted', deleteTargetName ? `"${deleteTargetName}" was removed.` : undefined)
    } catch (err: any) {
      toast.error('Could not delete course', err?.response?.data?.error?.message)
    }
  }

  return (
    <AnimatePresence>
      {deleteModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={closeDeleteModal}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
        >
          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="relative w-full max-w-[420px] rounded-3xl p-7"
            style={{ background: '#13162A', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close */}
            <button onClick={closeDeleteModal}
              className="absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.4)' }}>
              <X size={14} />
            </button>

            {/* Icon */}
            <motion.div
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, delay: 0.05 }}
              className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)' }}>
              <AlertTriangle size={22} style={{ color: '#EF4444' }} />
            </motion.div>

            <h2 className="mb-2 text-xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Delete course?
            </h2>
            <p className="mb-6 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
              <span className="font-semibold text-white">"{deleteTargetName}"</span> will be permanently removed.
              All enrolled students will lose access. This action cannot be undone.
            </p>

            <div className="flex gap-3">
              <button onClick={closeDeleteModal}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-colors hover:bg-white/[0.08]"
                style={{ color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
                Cancel
              </button>
              <motion.button
                whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                onClick={handleConfirm}
                disabled={deleteMutation.isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #EF4444, #DC2626)', boxShadow: '0 4px 16px rgba(239,68,68,0.30)' }}>
                {deleteMutation.isPending ? <><Spinner size={14} />Deleting…</> : 'Delete course'}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
