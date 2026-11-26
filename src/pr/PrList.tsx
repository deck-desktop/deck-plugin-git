// The open pull requests of a repo, in the Git Graph's side panel.
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, X, GitPullRequest } from "lucide-react";
import { toolBtn } from "../util";
import { PR_CHANGED, type PrRow } from "../prs";
import { usePrHost, prError, type PrFilter } from "../prhost";
import { ErrorText } from "../ErrorText";
import { STATE_COLOR, ago } from "./common";

/** The open pull requests, filtered: waiting on my review, mine, or all of them. */
export function PrList({ root, selected, onOpen, onClose }: {
  root: string; selected: number | null;
  /** `title`: what its tab is called, "PR #12" or "MR !12". */
  onOpen: (n: number, title: string) => void; onClose: () => void;
}) {
  const host = usePrHost(root);
  const [filter, setFilter] = useState<PrFilter>("all");
  const [rows, setRows] = useState<PrRow[] | null>(null);
  const [error, setError] = useState("");
  const load = () => {
    if (!host) return;
    setRows(null); setError("");
    void host.list(filter)
      .then(setRows)
      .catch((e) => { setRows([]); setError(prError(e)); });
  };
  useEffect(load, [host, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === root) load(); };
    window.addEventListener(PR_CHANGED, on);
    return () => window.removeEventListener(PR_CHANGED, on);
  }, [host, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 px-2.5 pb-1 pt-2">
        <span className="min-w-0 truncate text-[12.5px] font-medium text-text-primary">{host?.kind === "gitlab" ? "Merge requests" : "Pull requests"}</span>
        <button onClick={load} title="Refresh" className={toolBtn + " ml-auto"}><RefreshCw size={14} /></button>
        <button onClick={onClose} title="Close" className={toolBtn}><X size={14} /></button>
      </div>
      {/* Grouped buttons: one box, the filter that is on lit in the accent. */}
      <div className="px-2.5 pb-2">
        <div className="inline-flex max-w-full items-center gap-0.5 rounded-lg border border-subtle bg-elev p-0.5">
          {([["review", "Needs my review"], ["mine", "Mine"], ["all", "All"]] as const).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={"h-6 min-w-0 truncate rounded-md px-2 text-[11.5px] transition-colors " + (filter === f ? "text-text-primary" : "text-text-muted hover:bg-white/5 hover:text-text-primary")}
              style={filter === f ? { background: "var(--accent-soft)" } : undefined}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {(rows === null || !host) && <p className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-text-muted"><Loader2 size={13} className="animate-spin" /> Loading…</p>}
        {error && <div className="break-words px-2.5 py-2 text-[12px] leading-relaxed text-text-muted"><ErrorText e={error} root={root} pre={false} /></div>}
        {rows?.length === 0 && !error && (
          <p className="px-2.5 py-2 text-[12px] leading-relaxed text-text-muted">
            No open {host?.noun ?? "pull request"}s here{filter !== "all" ? " for this filter" : ""}. Create one from a branch's menu in the graph, or the PR button in its toolbar.
          </p>
        )}
        {host && rows?.map((r) => (
          <button key={r.number} onClick={() => onOpen(r.number, `${host.short} ${host.sign}${r.number}`)}
            className={"flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors " + (selected === r.number ? "" : "hover:bg-white/5")}
            style={selected === r.number ? { background: "var(--accent-soft)" } : undefined}>
            <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
              <GitPullRequest size={12} className="shrink-0" style={{ color: r.isDraft ? "var(--text-muted)" : STATE_COLOR[r.state] }} />
              <span className="truncate text-[12.5px] text-text-primary">{r.title}</span>
            </span>
            <span className="truncate pl-[18px] text-[11px] text-text-muted">
              {host.sign}{r.number} · {r.author} · {r.head} → {r.base}{r.isDraft ? " · draft" : ""} · {ago(r.updatedAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
