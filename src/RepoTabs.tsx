// A folder holding several repositories: how the pane picks one. A tab per repository above the
// graph, or a dropdown in its toolbar, as the user sets it.
import { useEffect, useRef, useState } from "react";
import { FolderGit2 } from "lucide-react";
import { configRead } from "../shim/bridge.js";
import { listen } from "../shim/event.js";
import { repoLabel } from "../shim/ui.js";

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

/** The dropdown, for the graph's toolbar. */
export function RepoSelect({ cwd, repos, repo, onPick }: { cwd: string; repos: string[]; repo: string; onPick: (r: string) => void }) {
  return (
    <select value={repo} onChange={(e) => onPick(e.target.value)} title="Repository"
      className="h-7 max-w-40 rounded-lg border border-subtle bg-elev px-2 text-[12px] text-text-primary outline-none transition-colors hover:border-strong focus:border-[var(--accent)]">
      {repos.map((r) => <option key={r} value={r}>{repoLabel(cwd, r)}</option>)}
    </select>
  );
}

/** The tabs: one row, scrolled sideways by the wheel when they do not fit. */
export function RepoTabs({ cwd, repos, repo, onPick }: { cwd: string; repos: string[]; repo: string; onPick: (r: string) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  // The open one in view, also when the pane comes back on a repo far along the row.
  useEffect(() => {
    strip.current?.querySelector("[data-open]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [repo]);
  return (
    <div ref={strip} className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-subtle px-1.5 [scrollbar-width:none]"
      onWheel={(e) => { if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
      {repos.map((r) => (
        <button key={r} title={r} data-open={r === repo || undefined} onClick={() => { if (r !== repo) onPick(r); }}
          className={"flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition-colors "
            + (r === repo ? "bg-white/[0.08] text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary")}>
          <FolderGit2 size={13} className="shrink-0" />{repoLabel(cwd, r)}
        </button>
      ))}
    </div>
  );
}
