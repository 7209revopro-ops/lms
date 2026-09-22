import { AuthPage } from '@/components/auth/AuthPage'

/* `/register?flow=full` is the link staff hand to a student who must complete
   the full application. On it the Express tab is not offered at all, so a
   student arriving through it cannot create an express account and nobody has
   to chase them to /complete-registration afterwards. Everything past the
   form is unchanged: full registration → pending → admin approval.

   Read here, on the server, so the client form never needs useSearchParams
   and the Suspense boundary that comes with it. */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flow } = await searchParams
  return <AuthPage initialMode="register" lockFull={flow === 'full'} />
}
