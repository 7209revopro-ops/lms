import { AuthPage } from '@/components/auth/AuthPage'

/* Mirrors register/page.tsx: `?flow=full` is carried across the Sign in /
   Sign up hop, so a reload here must re-derive the lock or the next hop to
   Sign up would mount the Express tab under a URL that still says flow=full. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flow } = await searchParams
  return <AuthPage initialMode="login" lockFull={flow === 'full'} />
}
