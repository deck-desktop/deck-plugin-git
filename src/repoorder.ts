// The order of a folder's repository tabs: the one saved, and a tab dragged to another's place.
// Pure, so repoorder.check.mjs tests it without Deck.

/** `repos` in the saved order; a repo the saved order does not name (new since) keeps git's order, after. */
export function inOrder(repos: readonly string[], saved: readonly string[] | undefined): string[] {
  if (!saved?.length) return [...repos];
  const at = (r: string) => { const i = saved.indexOf(r); return i < 0 ? saved.length : i; };
  return [...repos].sort((a, b) => at(a) - at(b)); // stable, so the unsaved keep their order
}

/** `from` moved to `to`'s place, as TabStrip's onReorder means it: dragged right lands after it. */
export function moved(list: readonly string[], from: string, to: string): string[] {
  const next = list.filter((r) => r !== from);
  next.splice(next.indexOf(to) + (list.indexOf(from) < list.indexOf(to) ? 1 : 0), 0, from);
  return next;
}
