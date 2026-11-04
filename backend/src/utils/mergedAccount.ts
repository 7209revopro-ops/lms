/* An account merged into another (services/accountMerge.service.ts) is closed,
   and the person is the account it was merged into. Lookups by EMAIL that act
   for the person — signing in, a guest checkout, the CS Portal, which may
   still know the student by the address that was closed — follow the merge.

   `load` re-reads by id with the caller's own select; it must include
   `mergedInto` for a chain (A into B, B later into C) to be followed. */
export async function followMerged<T extends { mergedInto?: unknown }>(
  doc: T | null,
  load: (id: unknown) => Promise<T | null>,
): Promise<T | null> {
  let cur = doc
  for (let hop = 0; cur?.mergedInto && hop < 5; hop++) cur = await load(cur.mergedInto)
  return cur
}
