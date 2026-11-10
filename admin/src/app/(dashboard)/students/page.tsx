'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { motion } from 'framer-motion'
import { PageHeader } from '@/components/ui/PageHeader'
import { UserTable } from '@/components/users/UserTable'
import { AddStudentModal } from '@/components/users/AddStudentModal'
import { useCurrentUser } from '@/lib/api/user'
import { useSearchParams } from 'next/navigation'
import { setQueryParams } from '@/lib/useQueryState'

export default function StudentsPage() {
  const searchParams = useSearchParams()
  const [modalOpen, setModalOpen] = useState(() => searchParams.get('add') === '1')
  const { data: me } = useCurrentUser()
  /* Not an instructor: the server never let them create an account (POST /admin/users) — and their Students page is
     every Forex student of their academy, to read (2026-11-10). */
  const canAddStudent = ['super_admin', 'admin'].includes(me?.role ?? '')
  const forexReader = me?.role === 'instructor'

  const handleClose = () => {
    setModalOpen(false)
    /* Drop only ?add=1 — the list's filters stay in the address bar. */
    setQueryParams({ add: null }, 'replace')
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Students"
          subtitle={forexReader ? 'Every Forex student of your academy — view only' : 'Everyone enrolled on the platform'}
          badge={{ label: 'Users', color: '#2F6BFF' }}
        />
        {canAddStudent && (
          <motion.button
            onClick={() => setModalOpen(true)}
            whileHover={{ y: -1, boxShadow: '0 6px 20px rgba(47,107,255,0.28)' }}
            whileTap={{ scale: 0.97 }}
            className="mt-1 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #2F6BFF, #5B8FFF)' }}
          >
            <UserPlus size={15} />
            Add Student
          </motion.button>
        )}
      </div>

      <UserTable role="student" label="Students" />

      {canAddStudent && <AddStudentModal open={modalOpen} onClose={handleClose} />}
    </div>
  )
}
