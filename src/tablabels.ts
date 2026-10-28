// What each repository tab says: its folder's name, and as many parent folders in front as it takes
// to tell it from another repository of the same name. Pure, so tablabels.check.mjs tests it.

export interface TabLabel {
  /** The folders in front, joined with "/" ("" when the name alone is unique). */
  parent: string;
  /** The repository's own folder. */
  name: string;
}

export function tabLabels(repos: readonly string[]): TabLabel[] {
  const parts = repos.map((r) => r.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean));
  const depth = parts.map(() => 1);
  const tail = (i: number) => parts[i].slice(-depth[i]).join("/").toLowerCase();
  // Lengthen every label that still matches another's, until none do or a path runs out.
  for (let changed = true; changed;) {
    changed = false;
    const seen = new Map<string, number[]>();
    parts.forEach((_, i) => seen.set(tail(i), [...(seen.get(tail(i)) ?? []), i]));
    for (const same of seen.values()) {
      if (same.length < 2) continue;
      for (const i of same) if (depth[i] < parts[i].length) { depth[i]++; changed = true; }
    }
  }
  return parts.map((p, i) => ({ parent: p.slice(-depth[i], -1).join("/"), name: p[p.length - 1] ?? "" }));
}
