// A folder holding several repositories: how the pane picks one. Tabs like the workspace tabs in the
// title bar, which can be dragged into an order of your own and show a dot for uncommitted changes,
// or a dropdown in the graph's toolbar, as the user sets it.
import { useEffect, useRef, useState } from "react";
import { configRead, configWrite, gitRun } from "../shim/bridge.js";
import { listen } from "../shim/event.js";
import { repoLabel, TabStrip } from "../shim/ui.js";
import { GIT_CHANGED } from "./WorkPanel";
import { baseName } from "./util";
import { inOrder, moved } from "./repoorder";

/** Declared, so Deck draws it on this plugin's page of Settings and writes it to `settings`. */
export const settings = [{
  in: "git", key: "repoPicker", title: "Repositories in one folder",
  desc: "When a workspace's folder holds several repositories: a tab for each above the graph, or a dropdown in its toolbar.",
  choices: [["tabs", "Tabs"], ["menu", "Dropdown"]], default: "tabs",
}];

/** Whether the repositories show as tabs: the setting, kept current. */
export function useRepoTabs(): boolean {
  const [tabs, setTabs] = useState(true);
  useEffect(() => {
    const read = () => configRead("settings")
      .then((t) => setTabs(!t.trim() || JSON.parse(t).repoPicker !== "menu"))
      .catch((e) => console.warn("[git] settings load failed", e));
    void read();
    // config-changed names this plugin's own configs as it names them, "settings" (the shim drops data/git/).
    const un = listen<string[]>("config-changed", (e) => { if (e.payload.includes("settings")) void read(); });
    return () => { void un.then((f) => f()); };
  }, []);
  return tabs;
}

// ---- the order you dragged them into ----------------------------------------------------------
// One config for every folder, `{ "<folder>": [repo, …] }`. Read once, written only when an order
// changes (rule 3). A repo not in the saved order (new since) goes after the ones that are.
const ORDER = "repo-order";
const folderKey = (cwd: string) => cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
let orders: Record<string, string[]> | null = null;
let ordersText = "";
const loadOrders = configRead(ORDER)
  .then((t) => { ordersText = t; orders = t.trim() ? JSON.parse(t) : {}; })
  .catch((e) => { console.warn("[git] repo order load failed", e); orders = {}; });

/** The repos in the order saved for this folder, and a way to move one to another's place. */
export function useRepoOrder(cwd: string, repos: string[]): [string[], (from: string, to: string) => void] {
  const [saved, setSaved] = useState<string[] | undefined>(orders?.[folderKey(cwd)]);
  useEffect(() => {
    let alive = true;
    void loadOrders.then(() => { if (alive) setSaved(orders?.[folderKey(cwd)]); });
    return () => { alive = false; };
  }, [cwd]);
  const list = inOrder(repos, saved);
  const move = (from: string, to: string) => {
    const next = moved(list, from, to);
    setSaved(next);
    orders = { ...(orders ?? {}), [folderKey(cwd)]: next };
    const text = JSON.stringify(orders);
    if (text === ordersText) return;
    ordersText = text;
    configWrite(ORDER, text).catch((e) => console.warn("[git] repo order save failed", e));
  };
  return [list, move];
}

// ---- which repos have uncommitted changes -----------------------------------------------------
// ponytail: one `git status` per repo every 10s while the window shows, fine for a handful of repos;
// a folder of dozens wants the watcher's signature shared instead.
const EVERY_MS = 10_000;

function useDirty(repos: string[]): ReadonlySet<string> {
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  const key = repos.join("\n");
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.hidden) return;
      const out = await Promise.all(repos.map((r) =>
        // --no-optional-locks: a read never takes .git/index.lock from an agent's git (see watch.ts).
        gitRun(r, ["--no-optional-locks", "status", "--porcelain"]).then((s) => s.trim() !== "", () => false)));
      if (stopped) return;
      const next = new Set(repos.filter((_, i) => out[i]));
      setDirty((prev) => (prev.size === next.size && [...next].every((r) => prev.has(r)) ? prev : next));
    };
    void check();
    const t = setInterval(check, EVERY_MS);
    const now = () => void check();
    window.addEventListener(GIT_CHANGED, now);
    document.addEventListener("visibilitychange", now);
    return () => { stopped = true; clearInterval(t); window.removeEventListener(GIT_CHANGED, now); document.removeEventListener("visibilitychange", now); };
  }, [key]);
  return dirty;
}

// ---- the two pickers --------------------------------------------------------------------------

/** The dropdown, for the graph's toolbar. */
export function RepoSelect({ cwd, repos, repo, onPick }: { cwd: string; repos: string[]; repo: string; onPick: (r: string) => void }) {
  return (
    <select value={repo} onChange={(e) => onPick(e.target.value)} title="Repository"
      className="h-7 max-w-40 rounded-lg border border-subtle bg-elev px-2 text-[12px] text-text-primary outline-none transition-colors hover:border-strong focus:border-[var(--accent)]">
      {repos.map((r) => <option key={r} value={r}>{repoLabel(cwd, r)}</option>)}
    </select>
  );
}

/** The tabs, each named by its folder (its path under the workspace when two share a name). */
export function RepoTabs({ cwd, repos, repo, onPick, onReorder }: {
  cwd: string; repos: string[]; repo: string; onPick: (r: string) => void; onReorder: (from: string, to: string) => void;
}) {
  const dirty = useDirty(repos);
  const strip = useRef<HTMLDivElement>(null);
  // The open one in view, also when the pane comes back on a repo far along the row.
  useEffect(() => {
    strip.current?.querySelector(`[data-repo="${CSS.escape(repo)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [repo]);
  const names = repos.map((r) => baseName(r));
  const tabs = repos.map((r, i) => ({
    id: r, dirty: dirty.has(r),
    title: <span data-repo={r} title={r}>{names.indexOf(names[i]) !== names.lastIndexOf(names[i]) ? repoLabel(cwd, r) : names[i]}</span>,
  }));
  return (
    <div ref={strip}>
      <TabStrip pill tabs={tabs} activeId={repo} onSelect={(r) => { if (r !== repo) onPick(r); }} onReorder={onReorder} />
    </div>
  );
}
