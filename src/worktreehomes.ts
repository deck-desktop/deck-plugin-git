// Where the repo's branches are checked out besides here: each one's worktree folder, from
// `git worktree list --porcelain`. The graph puts a folder on a branch's pill for it, so an agent's
// branch (Deck's "New agent on its own branch") reads as the branch it is, with a home. Pure;
// worktreehomes.check.mjs. The hook that reads them is useWorktreeHomes in worktrees.ts.

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
