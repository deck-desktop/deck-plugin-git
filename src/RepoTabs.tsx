// A folder holding several repositories: how the pane picks one. Tabs that look like the workspace
// tabs in the title bar, which can be dragged into an order of your own and show a dot for uncommitted changes,
// or a dropdown in the graph's toolbar, as the user sets it.
import { useEffect, useRef, useState } from "react";
import { configRead, configWrite, gitRun } from "../shim/bridge.js";
import { listen } from "../shim/event.js";
import { Plus, X } from "lucide-react";
import { ContextMenu, repoLabel, useRowDrag } from "../shim/ui.js";
import { useSettings } from "../shim/settings.js";
import { GIT_CHANGED } from "./WorkPanel";
import { tabLabels } from "./tablabels";
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

// ---- the order you dragged them into, and the ones you closed ---------------------------------
// Each a config for every folder, `{ "<folder>": [repo, …] }`: `repo-order` and `repo-hidden`. Read once,
// written only when a list changes (rule 3). A repo not in the saved order (new since) goes after
// the ones that are, and shows until it is closed.
const folderKey = (cwd: string) => cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** A per-folder list kept in one config: its hook, reading this folder's and saving a new one. */
function folderLists(config: string) {
  let all: Record<string, string[]> | null = null;
  let text = "";
  const loaded = configRead(config)
    .then((t) => { text = t; all = t.trim() ? JSON.parse(t) : {}; })
    .catch((e) => { console.warn(`[git] ${config} load failed`, e); all = {}; });
  return function useList(cwd: string): [string[] | undefined, (next: string[]) => void] {
    const [list, setList] = useState<string[] | undefined>(all?.[folderKey(cwd)]);
    useEffect(() => {
      let alive = true;
      void loaded.then(() => { if (alive) setList(all?.[folderKey(cwd)]); });
      return () => { alive = false; };
    }, [cwd]);
    const save = (next: string[]) => {
      setList(next);
      all = { ...(all ?? {}), [folderKey(cwd)]: next };
      const json = JSON.stringify(all);
      if (json === text) return;
      text = json;
      configWrite(config, json).catch((e) => console.warn(`[git] ${config} save failed`, e));
    };
    return [list, save];
  };
}
const useOrder = folderLists("repo-order");
const useHidden = folderLists("repo-hidden");

export interface RepoList {
  /** The repos with a tab, in the order saved for this folder. */
  shown: string[];
  /** The ones closed, for the + menu, in the same order. */
  hidden: string[];
  reorder: (from: string, to: string) => void;
  hide: (repo: string) => void;
  show: (repo: string) => void;
}

/** The folder's repos as its tabs show them: in your order, without the ones you closed. */
export function useRepoList(cwd: string, repos: string[]): RepoList {
  const [order, saveOrder] = useOrder(cwd);
  const [closed, saveClosed] = useHidden(cwd);
  const all = inOrder(repos, order);
  // Never none: a list that hides every repo (they were renamed, say) shows them all instead.
  const gone = new Set(closed ?? []);
  const fits = all.some((r) => !gone.has(r));
  return {
    shown: fits ? all.filter((r) => !gone.has(r)) : all,
    hidden: fits ? all.filter((r) => gone.has(r)) : [],
    reorder: (from, to) => saveOrder(moved(all, from, to)),
    hide: (r) => saveClosed([...(closed ?? []).filter((x) => repos.includes(x)), r]),
    show: (r) => saveClosed((closed ?? []).filter((x) => x !== r && repos.includes(x))),
  };
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

// The workspace tabs' look (Deck's modules/terminals/TabStrip.tsx, the title bar), drawn here rather
// than through Deck's shared TabStrip, which has no such variant: every tab on a faint surface of its
// own, the open one raised with the accent line under it. No icon: every tab would have the same one.
const DRAG_ID = "data-drag-id"; // dragrow's ROW_ATTR: the shim forwards functions, not constants
const CHANGED = "#facc15";

/**
 * The tabs, each named by its folder, with the parent folders in front that tell two of a name apart.
 * A tab closes from its X or a middle click, while another is left; the + at the end brings one back.
 */
export function RepoTabs({ repos, hidden, repo, onPick, onReorder, onHide, onShow }: {
  repos: string[]; hidden: string[]; repo: string; onPick: (r: string) => void; onReorder: (from: string, to: string) => void;
  onHide: (r: string) => void; onShow: (r: string) => void;
}) {
  const dirty = useDirty(repos);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closable = repos.length > 1;
  // Each as wide as a workspace tab: Settings' tab width, clamped as the title bar clamps it.
  // ponytail: the full width only, and the row scrolls; the title bar's "Fit tabs to the bar" is not followed.
  const width = Math.min(320, Math.max(120, useSettings().tabWidth ?? 160));
  const drag = useRowDrag((from, target) => { if (target && target.id !== from) onReorder(from, target.id); });
  const strip = useRef<HTMLDivElement>(null);
  // The open one in view, also when the pane comes back on a repo far along the row.
  useEffect(() => {
    strip.current?.querySelector(`[${DRAG_ID}="${CSS.escape(repo)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [repo]);
  // Over the closed ones too, so a tab is named the same way whether or not its namesake is shown.
  const labels = tabLabels([...repos, ...hidden]);
  const said = (i: number) => (labels[i].parent ? `${labels[i].parent}/` : "") + labels[i].name;
  return (
    // h-10 leaves room under the h-7 tabs, inside the row (which clips, as it scrolls), for the line.
    <div ref={strip} className="no-drag flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-subtle px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onWheel={(e) => { if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY; }}>
      {repos.map((r, i) => {
        const on = r === repo;
        const { parent, name } = labels[i];
        return (
          // A div, as the title bar's tabs are: it holds the close button, and a button cannot.
          <div key={r} {...{ [DRAG_ID]: r }} title={r} role="tab" aria-selected={on} tabIndex={0}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); else drag.startDrag(r)(e); }}
            // Click, not mousedown: a state change during mousedown aborts the drag (dragrow).
            onClick={() => { if (!drag.justDragged() && !on) onPick(r); }}
            onAuxClick={(e) => { if (e.button === 1 && closable) { e.preventDefault(); onHide(r); } }}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !on) { e.preventDefault(); onPick(r); } }}
            className={"group/tab relative flex h-7 flex-none cursor-default select-none items-center gap-1.5 rounded-md pl-2.5 pr-1 text-[12px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[var(--accent)] "
              + (on ? "font-medium text-text-primary" : "bg-[color-mix(in_srgb,var(--bg-elev)_50%,transparent)] text-text-muted hover:bg-[var(--bg-hover)] hover:text-text-primary")
              + (drag.dragId === r ? " ring-1 ring-[var(--accent)]" : "")}
            style={{ width, ...(on ? { background: "var(--bg-elev)", boxShadow: "inset 0 0 0 1px var(--border-strong)" } : {}) }}>
            {/* The parent folders give way first, so the repo's own name stays readable. */}
            <span className="flex min-w-0 flex-1 text-left">
              {parent && <><span className="min-w-0 truncate opacity-60">{parent}</span><span className="shrink-0 opacity-60">/</span></>}
              <span className="max-w-full shrink-0 truncate">{name}</span>
            </span>
            {dirty.has(r) && <span title="Uncommitted changes" className="size-1.5 shrink-0 rounded-full" style={{ background: CHANGED }} />}
            {/* Shown on hover, its room always kept, as the title bar's are. */}
            {closable
              ? <button aria-label={`Close ${said(i)}`} title="Close tab (middle-click)" onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onHide(r); }}
                  className="grid size-4 flex-none place-items-center rounded opacity-0 transition-opacity hover:bg-white/10 focus-visible:opacity-100 group-hover/tab:opacity-100">
                  <X size={11} />
                </button>
              : <span className="size-4 flex-none" />}
            {on && <span aria-hidden className="pointer-events-none absolute inset-x-2 -bottom-[5px] h-0.5 rounded-full" style={{ background: "var(--accent)" }} />}
          </div>
        );
      })}
      <button aria-label="Add a repository tab" title="Add a repository tab"
        onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); setMenu({ x: b.left, y: b.bottom + 4 }); }}
        className="grid h-7 w-7 flex-none place-items-center rounded text-text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-text-primary">
        <Plus size={14} />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}
        items={hidden.length
          ? hidden.map((r, i) => ({ label: said(repos.length + i), onClick: () => { onShow(r); onPick(r); } }))
          : [{ label: "Every repository has a tab", disabled: true, onClick: () => {} }]} />}
    </div>
  );
}
