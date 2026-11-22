// A commit's decoration refs as the graph shows them: what each is, and grouped into pills. Moved
// out of GitGraph.tsx as it stood.

// Classify a decoration ref → a small colored pill.
/** What a decoration entry actually is, so a menu can offer the right things for it. */
export type RefKind = "local" | "remote" | "tag" | "stash" | "head";
export interface ParsedRef { kind: RefKind; label: string; color: string; current: boolean }

/**
 * `remotes`: the repo's remote names, once known. A ref is a remote's only when it starts with one
 * (`origin/main`); without them, any name with a slash was taken for one, so a local `feature/x`
 * showed a cloud and lost what a local branch has (its worktree folder, Check out).
 */
export function parseRef(ref: string, remotes?: readonly string[]): ParsedRef {
  // "HEAD -> main" is the checked-out branch; the arrow is git's, not part of the name.
  if (ref.startsWith("HEAD -> ")) return { kind: "local", label: ref.slice(8), color: "#3794ff", current: true };
  if (ref === "HEAD") return { kind: "head", label: "HEAD", color: "#3794ff", current: true };
  if (ref.startsWith("tag: ")) return { kind: "tag", label: ref.slice(5), color: "#e2c08d", current: false };
  if (ref.startsWith("stash@")) return { kind: "stash", label: ref, color: "#4ec9b0", current: false };
  if (ref.includes("/") && (!remotes || remotes.some((r) => ref.startsWith(`${r}/`)))) return { kind: "remote", label: ref, color: "#c586c0", current: false };
  return { kind: "local", label: ref, color: "#3794ff", current: false };
}

/**
 * A commit's refs as GitKraken shows them: a local branch and its remote copies are one pill
 * ("main" with a laptop and a cloud) rather than two. Current branch first, then local, remote,
 * tags. `origin/HEAD` is dropped — a pointer to the default branch, not a branch.
 */
export interface RefGroup { name: string; local?: ParsedRef; remotes: ParsedRef[]; tag?: ParsedRef; other?: ParsedRef; current: boolean }
export function groupRefs(refs: string[], remotes?: readonly string[]): RefGroup[] {
  const groups = new Map<string, RefGroup>();
  for (const raw of refs) {
    const p = parseRef(raw, remotes);
    if (p.kind === "remote" && p.label.endsWith("/HEAD")) continue;
    const key = p.kind === "local" ? p.label
      : p.kind === "remote" ? p.label.slice(p.label.indexOf("/") + 1)
      : `${p.kind}:${p.label}`;
    // A remote's copy alone is named like the branch only for origin: with a second remote the
    // bare name was ambiguous — the testbed showed two pills reading "main" on different commits.
    const g = groups.get(key) ?? { name: p.kind === "remote" && !p.label.startsWith("origin/") ? p.label : key, remotes: [], current: false };
    if (p.kind === "local") g.local = p;
    else if (p.kind === "remote") g.remotes.push(p);
    else if (p.kind === "tag") g.tag = p;
    else g.other = p;
    g.current ||= p.current;
    groups.set(key, g);
  }
  // origin's copy first: the cloud opens it, and it is the one a PR is about.
  for (const g of groups.values()) g.remotes.sort((a, b) => Number(b.label.startsWith("origin/")) - Number(a.label.startsWith("origin/")));
  const rank = (g: RefGroup) => (g.current ? 0 : g.local ? 1 : g.remotes.length ? 2 : g.tag ? 3 : 4);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}
export const isBranch = (g: RefGroup) => !!(g.local || g.remotes.length);
