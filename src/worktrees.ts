// The graph's view of the repo's other worktrees: for each branch checked out in one, its folder and
// how many uncommitted changes are there (an agent's work in progress). Read again when the graph is,
// and every 15s while it is on screen, as an agent working there changes it without telling anyone.
import { useEffect, useState } from "react";
import { gitRun } from "../shim/bridge.js";
import { parseHomes, type Home } from "./worktreehomes";

export interface BranchHome extends Home { changed: number }

const same = (a: Map<string, BranchHome>, b: Map<string, BranchHome>) =>
  a.size === b.size && [...b].every(([k, v]) => { const o = a.get(k); return o && o.path === v.path && o.changed === v.changed; });

/** Branch name to its worktree; `version` changing (the graph read again) reads them again. */
export function useWorktreeHomes(root: string, version: unknown): Map<string, BranchHome> {
  const [homes, setHomes] = useState<Map<string, BranchHome>>(() => new Map());
  useEffect(() => {
    let stopped = false;
    const read = async () => {
      if (document.hidden) return;
      const list = parseHomes(await gitRun(root, ["worktree", "list", "--porcelain"]).catch(() => ""));
      const next = new Map<string, BranchHome>();
      for (const h of list) {
        // --no-optional-locks: a look never takes the index lock from the agent working there.
        const changed = (await gitRun(h.path, ["--no-optional-locks", "status", "--porcelain"]).catch(() => ""))
          .split(/\r?\n/).filter(Boolean).length;
        next.set(h.branch, { ...h, changed });
      }
      if (!stopped) setHomes((prev) => (same(prev, next) ? prev : next));
    };
    void read();
    const id = setInterval(() => void read(), 15_000);
    return () => { stopped = true; clearInterval(id); };
  }, [root, version]);
  return homes;
}
