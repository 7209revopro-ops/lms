/* ─────────────────────────────────────────────────────
   Two spellings of the same four programmes, everywhere in this codebase.

   Student-facing / course-scoping vocabulary (Course.program, categoryScope,
   User.category):        'ai' | 'digital-marketing' | '4x-trading' | 'jura'
   sub_admin's own vocabulary (User.program):
                           'ai' | 'digital_marketing' | 'forex'     | 'jura'

   This exact table used to be copy-pasted independently in reminders.job.ts,
   classHandoff.service.ts and auth.middleware.ts's injectCategoryScope — three
   places that could drift out of agreement with each other with no test able
   to catch it, which is exactly the shape of bug this session kept finding
   (see the org-switcher scoping fixes). One table now; everything else calls
   into it. ───────────────────────────────────────────────────────────── */

export type StudentProgram = '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
export type SubAdminProgram = 'forex' | 'digital_marketing' | 'ai' | 'jura'

const STUDENT_TO_SUB_ADMIN: Record<StudentProgram, SubAdminProgram> = {
  'ai':                'ai',
  'digital-marketing': 'digital_marketing',
  '4x-trading':        'forex',
  'jura':               'jura',
}

const SUB_ADMIN_TO_STUDENT: Record<SubAdminProgram, StudentProgram> = {
  'ai':               'ai',
  'digital_marketing':'digital-marketing',
  'forex':            '4x-trading',
  'jura':              'jura',
}

/** Course/categoryScope vocabulary → the sub_admin.program vocabulary. */
export function toSubAdminProgram(studentProgram: string | null | undefined): SubAdminProgram | undefined {
  return studentProgram ? STUDENT_TO_SUB_ADMIN[studentProgram as StudentProgram] : undefined
}

/** sub_admin.program vocabulary → the course/categoryScope vocabulary. */
export function toStudentProgram(subAdminProgram: string | null | undefined): StudentProgram | undefined {
  return subAdminProgram ? SUB_ADMIN_TO_STUDENT[subAdminProgram as SubAdminProgram] : undefined
}
