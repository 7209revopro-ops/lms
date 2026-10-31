'use client'
/* Lessons wait for the registration form of a paid /explore buyer (lib/registrationGate.ts) —
   the course page and its outline stay open, the lesson itself shows the way on. The server
   refuses the video, quiz and progress calls too; this is what the student sees. */
import { useParams } from 'next/navigation'
import { useCurrentUser } from '@/lib/api/user'
import { RegistrationLocked } from '@/components/auth/RegistrationLocked'

export default function LessonGateLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser()
  const { slug } = useParams<{ slug: string }>()
  if (isLoading) return null
  if (user?.role === 'student' && user.registrationDue) {
    return <RegistrationLocked action="lesson" backHref={`/courses/${encodeURIComponent(slug ?? '')}`} backLabel="Back to the course" />
  }
  return <>{children}</>
}
