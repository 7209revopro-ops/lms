import { env } from '@/config/env.ts'

/* Single source for "how long should this refresh session last".

   Before this existed, three places each read JWT_REFRESH_EXPIRES_IN
   independently — the refresh JWT's own exp claim, the RefreshToken DB row's
   expiresAt (TTL index), and the lms_rt cookie's Max-Age — and only agreed
   with each other because all three happened to default to the same env var.
   Threading a "remember me" choice through meant giving exactly one of them
   a different answer without the others finding out, which is precisely the
   kind of drift a session-expiry system cannot afford: a cookie that outlives
   its JWT looks like a dead session; a JWT that outlives its cookie is a
   valid token nothing will ever present again but that reuse-detection must
   still track. This is the one function all three now call. */
export function refreshTtl(remember: boolean | undefined): string {
  return remember === false ? env.JWT_REFRESH_EXPIRES_IN_UNREMEMBERED : env.JWT_REFRESH_EXPIRES_IN
}
