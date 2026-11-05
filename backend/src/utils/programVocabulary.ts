/* ─────────────────────────────────────────────────────
   Two spellings of the same five programmes, everywhere in this codebase.

   Student-facing / course-scoping vocabulary (Course.program, categoryScope,
   User.category):        'ai' | 'digital-marketing' | '4x-trading' | 'jura' | 'cma'
   sub_admin's own vocabulary (User.program):
                           'ai' | 'digital_marketing' | 'forex'     | 'jura' | 'cma'

   This exact table used to be copy-pasted independently in reminders.job.ts,
   classHandoff.service.ts and auth.middleware.ts's injectCategoryScope — three
   places that could drift out of agreement with each other with no test able
   to catch it, which is exactly the shape of bug this session kept finding
   (see the org-switcher scoping fixes). One table now; everything else calls
   into it. ───────────────────────────────────────────────────────────── */

export type StudentProgram = '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | 'cma'
export type SubAdminProgram = 'forex' | 'digital_marketing' | 'ai' | 'jura' | 'cma'

const STUDENT_TO_SUB_ADMIN: Record<StudentProgram, SubAdminProgram> = {
  'ai':                'ai',
  'digital-marketing': 'digital_marketing',
  '4x-trading':        'forex',
  'jura':               'jura',
  'cma':                'cma',
}

const SUB_ADMIN_TO_STUDENT: Record<SubAdminProgram, StudentProgram> = {
  'ai':               'ai',
  'digital_marketing':'digital-marketing',
  'forex':            '4x-trading',
  'jura':              'jura',
  'cma':               'cma',
}

/** Course/categoryScope vocabulary → the sub_admin.program vocabulary. */
export function toSubAdminProgram(studentProgram: string | null | undefined): SubAdminProgram | undefined {
  return studentProgram ? STUDENT_TO_SUB_ADMIN[studentProgram as StudentProgram] : undefined
}

/** sub_admin.program vocabulary → the course/categoryScope vocabulary. */
export function toStudentProgram(subAdminProgram: string | null | undefined): StudentProgram | undefined {
  return subAdminProgram ? SUB_ADMIN_TO_STUDENT[subAdminProgram as SubAdminProgram] : undefined
}
