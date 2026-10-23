/** "Good morning" / "afternoon" / "evening" by the phone's own clock. */
export function bucketOfDayGreeting(d: Date): 'morning' | 'afternoon' | 'evening' {
  const h = d.getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}
