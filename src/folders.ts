// The folders whose repositories the graph offers: every folder of the project the pane is in, on
// this PC, its own first (Deck's multi-root projects, core/workspaces/folders.ts). On a Deck without
// them, or a pane outside the active project, just the pane's folder.
import * as terminals from "../shim/terminals.js";

const key = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
/** host:/path, a folder on a server: git runs on this PC, so its repos are not offered. */
const remote = (p: string) => /^[A-Za-z0-9._@-]{2,}(\+sudo)?:\//.test(p);

export function projectFolders(cwd: string): string[] {
  let all: string[];
  try { all = terminals.activeWorkspaceFolders(); } catch { return [cwd]; }
  const local = all.filter((f) => f && !remote(f));
  if (!local.some((f) => key(f) === key(cwd))) return [cwd];
  return [cwd, ...local.filter((f) => key(f) !== key(cwd))];
}

/** The same repository spelled two ways (case, slashes) once: the first spelling kept. */
export const uniqueRepos = (lists: string[][]): string[] =>
  [...new Map(lists.flat().map((x) => [key(x), x])).values()];
