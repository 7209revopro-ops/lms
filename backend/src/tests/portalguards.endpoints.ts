/* GENERATED — every API path the admin and client apps actually call.
   Rebuilt by scraping api.get/post/patch/delete literals out of both
   frontends, so the sweep tracks the real call surface rather than a
   hand-kept list that drifts. Template holes become a valid ObjectId so
   routing resolves; a 404 from the handler is a fine outcome here, the
   sweep only cares which auth guard answered. */
export const ENDPOINTS = [
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/categories/000000000000000000000000",
    "src": "admin/src/lib/api/categories.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/coupons/000000000000000000000000",
    "src": "admin/src/app/(dashboard)/coupons/page.tsx"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/courses/000000000000000000000000",
    "src": "admin/src/lib/api/courses.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/enrollments/000000000000000000000000",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/express-members/000000000000000000000000",
    "src": "admin/src/lib/api/expressMembers.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/homework/000000000000000000000000",
    "src": "admin/src/app/(dashboard)/live-classes/[id]/homework/page.tsx"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/lessons/000000000000000000000000",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/lessons/000000000000000000000000/quiz",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/live-classes/000000000000000000000000",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/reviews/000000000000000000000000",
    "src": "admin/src/lib/api/reviews.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/roles/000000000000000000000000",
    "src": "admin/src/lib/api/roles.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/sections/000000000000000000000000",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/admin/users/000000000000000000000000",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "DELETE",
    "path": "/learning-paths/000000000000000000000000",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/analytics/completion",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/analytics/enrollments",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/analytics/revenue",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/analytics/top-courses",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/auth/me",
    "src": "admin/src/lib/api/user.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/availability/me",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/bookings",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/categories",
    "src": "admin/src/lib/api/categories.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/coupons",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/courses",
    "src": "admin/src/lib/api/courses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/courses/000000000000000000000000/live-classes",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/courses/000000000000000000000000/outline",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/courses/000000000000000000000000",
    "src": "admin/src/lib/api/courses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/courses/by-program/000000000000000000000000",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/enrollment-requests",
    "src": "admin/src/lib/api/enrollmentRequests.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/express-members",
    "src": "admin/src/lib/api/expressMembers.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/lessons/000000000000000000000000/assignment",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/lessons/000000000000000000000000/quiz",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/live-classes",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/live-classes/000000000000000000000000",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/live-classes/000000000000000000000000/feedback",
    "src": "admin/src/app/(dashboard)/live-classes/[id]/feedback/page.tsx"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/live-classes/000000000000000000000000/stream-credentials",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/live-classes/000000000000000000000000/homework",
    "src": "admin/src/app/(dashboard)/live-classes/[id]/homework/page.tsx"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/live-classes/000000000000000000000000/homework/submissions",
    "src": "admin/src/app/(dashboard)/live-classes/[id]/homework/page.tsx"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/mentors/000000000000000000000000/availability",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/orders",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/organizations",
    "src": "admin/src/lib/api/organizations.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/reports/attendance",
    "src": "admin/src/app/(dashboard)/reports/page.tsx"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/reports/mentor-schedule",
    "src": "admin/src/app/(dashboard)/reports/page.tsx"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/reviews",
    "src": "admin/src/lib/api/reviews.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/roles",
    "src": "admin/src/lib/api/roles.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/stats",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/students/000000000000000000000000/enrollments",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/users",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/users/000000000000000000000000/enrollments",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/users/000000000000000000000000/orders",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/admin/viewers",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/audit-logs",
    "src": "admin/src/lib/api/auditlogs.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/class-assignments/review",
    "src": "admin/src/lib/api/classAssignments.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/documents/000000000000000000000000/000000000000000000000000",
    "src": "admin/src/lib/api/documents.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/learning-paths/admin/list",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/support/000000000000000000000000",
    "src": "admin/src/lib/api/support.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/support/admin",
    "src": "admin/src/lib/api/support.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/support/admin/performance",
    "src": "admin/src/lib/api/support.ts"
  },
  {
    "app": "admin",
    "verb": "GET",
    "path": "/support/admin/stats",
    "src": "admin/src/lib/api/support.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/bookings/000000000000000000000000/attendance",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/categories/000000000000000000000000",
    "src": "admin/src/lib/api/categories.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/coupons/000000000000000000000000",
    "src": "admin/src/app/(dashboard)/coupons/page.tsx"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/courses/000000000000000000000000",
    "src": "admin/src/lib/api/courses.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/enrollment-requests/000000000000000000000000/approve",
    "src": "admin/src/lib/api/enrollmentRequests.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/enrollment-requests/000000000000000000000000/reject",
    "src": "admin/src/lib/api/enrollmentRequests.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/enrollment-requests/000000000000000000000000/remove-category",
    "src": "admin/src/lib/api/enrollmentRequests.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/enrollment-requests/000000000000000000000000/revoke-to-viewer",
    "src": "admin/src/lib/api/enrollmentRequests.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/enrollments/000000000000000000000000",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/express-members/000000000000000000000000/block",
    "src": "admin/src/lib/api/expressMembers.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/homework-submissions/000000000000000000000000/grade",
    "src": "admin/src/app/(dashboard)/live-classes/[id]/homework/page.tsx"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/lessons/000000000000000000000000",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/live-classes/000000000000000000000000",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/roles/000000000000000000000000",
    "src": "admin/src/lib/api/roles.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/roles/000000000000000000000000/permissions",
    "src": "admin/src/lib/api/roles.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/sections/000000000000000000000000",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/users/000000000000000000000000",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/users/000000000000000000000000/block",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/users/000000000000000000000000/unblock",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/admin/users/000000000000000000000000/assign-role",
    "src": "admin/src/lib/api/roles.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/class-assignments/000000000000000000000000/review",
    "src": "admin/src/lib/api/classAssignments.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/learning-paths/000000000000000000000000",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/lessons/000000000000000000000000/transcript",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "PATCH",
    "path": "/support/000000000000000000000000/status",
    "src": "admin/src/lib/api/support.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/auth/login",
    "src": "admin/src/components/auth/AdminLoginForm.tsx"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/auth/login/2fa",
    "src": "admin/src/components/auth/AdminLoginForm.tsx"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/auth/logout",
    "src": "admin/src/lib/api/user.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/bookings/book-for-student",
    "src": "admin/src/lib/api/adminBookings.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/categories",
    "src": "admin/src/lib/api/categories.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/coupons",
    "src": "admin/src/app/(dashboard)/coupons/page.tsx"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/courses",
    "src": "admin/src/lib/api/courses.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/courses/000000000000000000000000/sections",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/courses/bulk",
    "src": "admin/src/lib/api/courses.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/lessons",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/lessons/000000000000000000000000/move",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/live-classes",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/live-classes/000000000000000000000000/end",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/live-classes/000000000000000000000000/homework",
    "src": "admin/src/app/(dashboard)/live-classes/[id]/homework/page.tsx"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/live-classes/000000000000000000000000/recreate",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/live-classes/000000000000000000000000/repeat",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/live-classes/000000000000000000000000/start",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/orders/000000000000000000000000/refund",
    "src": "admin/src/app/(dashboard)/orders/page.tsx"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/roles",
    "src": "admin/src/lib/api/roles.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/students/000000000000000000000000/revoke",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/students/000000000000000000000000/enroll",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/users",
    "src": "admin/src/components/users/AddUserModal.tsx"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/users/000000000000000000000000/enrollments",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/users/000000000000000000000000/impersonate",
    "src": "admin/src/lib/api/users.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/viewers/000000000000000000000000/approve",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/admin/auth/refresh",
    "src": "admin/src/lib/axios.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/learning-paths",
    "src": "admin/src/lib/api/stats.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/lessons/000000000000000000000000/generate-transcript",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/support/000000000000000000000000/messages",
    "src": "admin/src/lib/api/support.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/uploads/document",
    "src": "admin/src/components/instructors/AddInstructorModal.tsx"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/uploads/image",
    "src": "admin/src/lib/api/upload.ts"
  },
  {
    "app": "admin",
    "verb": "POST",
    "path": "/uploads/presign",
    "src": "admin/src/lib/api/upload.ts"
  },
  {
    "app": "admin",
    "verb": "PUT",
    "path": "/admin/availability/me",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "PUT",
    "path": "/admin/courses/000000000000000000000000/sections/reorder",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "PUT",
    "path": "/admin/lessons/000000000000000000000000/assignment",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "PUT",
    "path": "/admin/lessons/000000000000000000000000/quiz",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "PUT",
    "path": "/admin/mentors/000000000000000000000000/availability",
    "src": "admin/src/lib/api/liveClasses.ts"
  },
  {
    "app": "admin",
    "verb": "PUT",
    "path": "/admin/sections/000000000000000000000000/lessons/reorder",
    "src": "admin/src/lib/api/outline.ts"
  },
  {
    "app": "admin",
    "verb": "PUT",
    "path": "/admin/students/000000000000000000000000/enrollments/000000000000000000000000/sections",
    "src": "admin/src/lib/api/students.ts"
  },
  {
    "app": "client",
    "verb": "DELETE",
    "path": "/auth/account",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "DELETE",
    "path": "/auth/sessions/000000000000000000000000",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "DELETE",
    "path": "/bookings/000000000000000000000000",
    "src": "client/src/lib/api/bookings.ts"
  },
  {
    "app": "client",
    "verb": "DELETE",
    "path": "/bookmarks/000000000000000000000000",
    "src": "client/src/lib/api/bookmarks.ts"
  },
  {
    "app": "client",
    "verb": "DELETE",
    "path": "/comments/000000000000000000000000",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "DELETE",
    "path": "/favorites/000000000000000000000000",
    "src": "client/src/lib/api/favorites.ts"
  },
  {
    "app": "client",
    "verb": "DELETE",
    "path": "/lessons/000000000000000000000000/my-note",
    "src": "client/src/lib/api/notes.ts"
  },
  {
    "app": "client",
    "verb": "DELETE",
    "path": "/threads/000000000000000000000000",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/achievements/me",
    "src": "client/src/lib/api/achievements.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/auth/2fa/status",
    "src": "client/src/lib/api/totp.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/auth/me",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/auth/sessions",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/bookings/me",
    "src": "client/src/lib/api/bookings.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/categories",
    "src": "client/src/lib/api/categories.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/certificates/000000000000000000000000",
    "src": "client/src/components/learn/CertificateButton.tsx"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/checkout/config",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/class-assignments/me",
    "src": "client/src/lib/api/classAssignments.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/class-assignments/submittable",
    "src": "client/src/lib/api/classAssignments.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/coupons/validate",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses",
    "src": "client/src/components/layout/ClientTopbar.tsx"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000/bookmarks",
    "src": "client/src/lib/api/bookmarks.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000/my-notes",
    "src": "client/src/lib/api/notes.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000/reviews",
    "src": "client/src/lib/api/reviews.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000",
    "src": "client/src/lib/api/courses.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000/ai-notes",
    "src": "client/src/lib/api/aiNotes.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000/live-classes",
    "src": "client/src/lib/api/liveClasses.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000/progress",
    "src": "client/src/lib/api/enrollments.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000/rating-histogram",
    "src": "client/src/lib/api/courses.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/courses/000000000000000000000000/recommendations",
    "src": "client/src/lib/api/recommendations.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/documents/000000000000000000000000/000000000000000000000000",
    "src": "client/src/lib/api/documents.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/enrollments/activity",
    "src": "client/src/lib/api/enrollments.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/enrollments/me",
    "src": "client/src/lib/api/enrollments.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/favorites/exists/000000000000000000000000",
    "src": "client/src/lib/api/favorites.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/favorites/me",
    "src": "client/src/lib/api/favorites.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/feedback/me",
    "src": "client/src/lib/api/feedback.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/health",
    "src": "client/src/hooks/useServerNow.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/instructors",
    "src": "client/src/lib/api/instructors.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/learning-paths",
    "src": "client/src/lib/api/learningpaths.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/learning-paths/000000000000000000000000",
    "src": "client/src/lib/api/learningpaths.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/lessons/000000000000000000000000/bookmarks",
    "src": "client/src/lib/api/bookmarks.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/lessons/000000000000000000000000/my-note",
    "src": "client/src/lib/api/notes.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/lessons/000000000000000000000000/progress",
    "src": "client/src/lib/api/progress.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/lessons/000000000000000000000000/threads",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/lessons/000000000000000000000000/transcript",
    "src": "client/src/lib/api/transcript.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/live-classes",
    "src": "client/src/lib/api/liveClasses.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/live-classes/000000000000000000000000/watch",
    "src": "client/src/lib/api/liveClasses.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/live-classes/000000000000000000000000/homework",
    "src": "client/src/lib/api/homework.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/live-classes/upcoming",
    "src": "client/src/lib/api/liveClasses.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/notifications",
    "src": "client/src/lib/api/notifications.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/notifications/unread-count",
    "src": "client/src/lib/api/notifications.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/orders/me",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/quizzes/lessons/000000000000000000000000",
    "src": "client/src/lib/api/quizzes.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/quizzes/lessons/000000000000000000000000/summary",
    "src": "client/src/lib/api/quizzes.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/streaks/me",
    "src": "client/src/lib/api/streaks.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/support/000000000000000000000000",
    "src": "client/src/lib/api/support.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/support/me",
    "src": "client/src/lib/api/support.ts"
  },
  {
    "app": "client",
    "verb": "GET",
    "path": "/threads/000000000000000000000000/comments",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "PATCH",
    "path": "/auth/me",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "PATCH",
    "path": "/auth/me/complete-registration",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "PATCH",
    "path": "/auth/me/password",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "PATCH",
    "path": "/streaks/me/goal",
    "src": "client/src/lib/api/streaks.ts"
  },
  {
    "app": "client",
    "verb": "PATCH",
    "path": "/threads/000000000000000000000000/resolve",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/ai/chat",
    "src": "client/src/lib/api/ai.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/refresh",
    "src": "client/src/lib/axios.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/uploads/image",
    "src": "client/src/lib/api/upload.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/uploads/presign",
    "src": "client/src/lib/api/upload.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/2fa/disable",
    "src": "client/src/lib/api/totp.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/2fa/enable",
    "src": "client/src/lib/api/totp.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/2fa/setup",
    "src": "client/src/lib/api/totp.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/deactivate",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/forgot-password",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/login",
    "src": "client/src/components/auth/LoginForm.tsx"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/login/2fa",
    "src": "client/src/components/auth/LoginForm.tsx"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/logout",
    "src": "client/src/components/auth/LoginForm.tsx"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/register",
    "src": "client/src/components/auth/RegisterForm.tsx"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/resend-verification",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/reset-password",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/auth/verify-email",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/bookings",
    "src": "client/src/lib/api/bookings.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/abzer/create-order",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/abzer/verify-return",
    "src": "client/src/lib/api/user.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/razorpay/create-order",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/razorpay/verify",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/tabby/create-order",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/tabby/prescore",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/tabby/verify-return",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/tamara/create-order",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/tamara/prescore",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/checkout/tamara/verify-return",
    "src": "client/src/lib/api/checkout.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/class-assignments",
    "src": "client/src/lib/api/classAssignments.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/class-assignments/000000000000000000000000/resubmit",
    "src": "client/src/lib/api/classAssignments.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/comments/000000000000000000000000/upvote",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/courses/000000000000000000000000/reviews",
    "src": "client/src/lib/api/reviews.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/enrollments",
    "src": "client/src/lib/api/enrollments.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/favorites",
    "src": "client/src/lib/api/favorites.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/feedback",
    "src": "client/src/lib/api/feedback.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/lessons/000000000000000000000000/bookmarks",
    "src": "client/src/lib/api/bookmarks.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/lessons/000000000000000000000000/complete",
    "src": "client/src/lib/api/progress.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/lessons/000000000000000000000000/threads",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/lessons/000000000000000000000000/watch-time",
    "src": "client/src/lib/api/progress.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/live-classes/homework/000000000000000000000000/submit",
    "src": "client/src/lib/api/homework.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/notifications/000000000000000000000000/read",
    "src": "client/src/lib/api/notifications.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/notifications/read-all",
    "src": "client/src/lib/api/notifications.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/quizzes/lessons/000000000000000000000000/submit",
    "src": "client/src/lib/api/quizzes.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/reviews/000000000000000000000000/helpful",
    "src": "client/src/lib/api/reviews.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/reviews/000000000000000000000000/report",
    "src": "client/src/lib/api/reviews.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/support",
    "src": "client/src/lib/api/support.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/support/000000000000000000000000/messages",
    "src": "client/src/lib/api/support.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/threads/000000000000000000000000/comments",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/threads/000000000000000000000000/upvote",
    "src": "client/src/lib/api/discussion.ts"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/uploads/000000000000000000000000",
    "src": "client/src/components/settings/RequestSection.tsx"
  },
  {
    "app": "client",
    "verb": "POST",
    "path": "/uploads/document",
    "src": "client/src/lib/api/classAssignments.ts"
  },
  {
    "app": "client",
    "verb": "PUT",
    "path": "/lessons/000000000000000000000000/my-note",
    "src": "client/src/lib/api/notes.ts"
  }
] as const
