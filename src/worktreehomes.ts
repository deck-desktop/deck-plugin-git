// Where the repo's branches are checked out besides here: each one's worktree folder, from
// `git worktree list --porcelain`. The graph puts a folder on a branch's pill for it, so an agent's
// branch (Deck's "New agent on its own branch") reads as the branch it is, with a home. Pure;
// worktreehomes.check.mjs. The hook that reads them is useWorktreeHomes in worktrees.ts.
import type { GraphCommit } from "../shim/bridge.js";

/** A branch checked out in a worktree other than the repo's own: its folder. */
export interface Home { branch: string; path: string; folder: string }

export function parseHomes(porcelain: string): Home[] {
  const out: Home[] = [];
  const blocks = porcelain.replace(/\r/g, "").split(/\n\n+/);
  // The first block is the repo's own checkout: its branch is "here", not elsewhere.
  for (const block of blocks.slice(1)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "");
    if (!path || !branch || lines.some((l) => l.startsWith("prunable"))) continue;
    out.push({ branch, path, folder: path.split(/[\\/]/).filter(Boolean).pop() ?? path });
  }
  return out;
}

export interface BranchHome extends Home { changed: number }

/** The id of another worktree's "uncommitted changes" row (the repo's own is GitGraph's WORKTREE). */
export const OTHER_WORK = "worktree:";
export const isOtherWork = (hash: string) => hash.startsWith(OTHER_WORK);

/**
 * The log with a row of uncommitted changes above the tip of each branch an agent is working on in
 * another worktree, as the repo's own checkout has above HEAD (the same words: it sits on the branch's
 * lane, so the folder needs no naming): dotted, its parent the branch's tip,
 * so the lanes draw it on the branch. A branch whose tip is not in the log (filtered out) gets none.
 */
export function withWorktreeRows(list: GraphCommit[], homes: Map<string, BranchHome>): GraphCommit[] {
  let out = list;
  for (const h of homes.values()) {
    if (!h.changed) continue;
    const at = out.findIndex((c) => c.refs.some((r) => r === h.branch || r === `HEAD -> ${h.branch}`));
    if (at < 0) continue;
    const row: GraphCommit = { hash: OTHER_WORK + h.path, parents: [out[at].hash], author: "", email: "", date: "",
      subject: `Uncommitted changes · ${h.changed} file${h.changed === 1 ? "" : "s"}`, body: "", refs: [] };
    out = [...out.slice(0, at), row, ...out.slice(at)];
  }
  return out;
}
