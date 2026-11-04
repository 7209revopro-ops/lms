/* One key per phone NUMBER, however it was typed — so two accounts on the same
   phone can be found (services/accountMerge.service.ts).

   Students' numbers are free text in two fields (`phone`, and
   `enrollmentApplication.phone`): the sign-up form sends "+971 56 802 1277",
   an import sends "0568021277", an admin types "971568021277". Each becomes
   "971568021277". Only the two academies' countries are understood; anything
   else is its digits, which still matches itself typed the same way.

   Returns null for what cannot be a phone number (fewer than 7 digits, or
   one digit over and over). */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length < 7 || d.length > 15) return null
  /* A placeholder typed to get past a form ("0000000000", "1111111111") is nobody's number. */
  const rest = d.replace(/^0+/, '')
  if (!rest || /^(\d)\1*$/.test(rest)) return null
  /* UAE: +971 then 9 digits; locally 0 + 9 digits, or the 9 digits alone (a mobile, 5…). */
  if (d.startsWith('971') && d.length === 12) return d
  if (d.startsWith('0') && d.length === 10) return '971' + d.slice(1)
  if (d.length === 9 && d.startsWith('5')) return '971' + d
  /* India: +91 then 10 digits; locally the 10 digits (6–9…), or 0 + the 10. */
  if (d.startsWith('91') && d.length === 12) return d
  if (d.length === 10 && /^[6-9]/.test(d)) return '91' + d
  if (d.startsWith('0') && d.length === 11) return '91' + d.slice(1)
  return d
}
