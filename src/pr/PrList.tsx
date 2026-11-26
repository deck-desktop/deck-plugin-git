// The open pull requests of a repo, in the Git Graph's side panel: one list in groups (waiting for
// your review, yours, everyone else's, and bots' folded into one row), searched from the top. Each
// row gives the title in full, who and when, and the one thing that decides it next.
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, X, GitPullRequest, Search, Bot, ChevronRight, ChevronDown } from "lucide-react";
import { toolBtn, field, countChip, heading } from "../util";
import { PR_CHANGED, type PrRow } from "../prs";
import { usePrHost, prError, type PrHost } from "../prhost";
import { ErrorText } from "../ErrorText";
import { STATE_COLOR, TONE, ago } from "./common";
import { groupRows, rowStatus } from "./status";

interface Lists { all: PrRow[]; review: PrRow[] | null; mine: PrRow[] | null }

export function PrList({ root, selected, onOpen, onClose }: {
  root: string; selected: number | null;
  /** `title`: what its tab is called, "PR #12" or "MR !12". */
  onOpen: (n: number, title: string) => void; onClose: () => void;
}) {
  const host = usePrHost(root);
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [botsOpen, setBotsOpen] = useState(false);
  const load = () => {
    if (!host) return;
    setLists(null); setError("");
    // Three questions to the host at once; only "all" failing is an error. The other two failing
    // leaves their rows in the groups after.
    void Promise.allSettled([host.list("all"), host.list("review"), host.list("mine")]).then(([all, review, mine]) => {
      if (all.status === "rejected") { setLists({ all: [], review: null, mine: null }); setError(prError(all.reason)); return; }
      for (const r of [review, mine]) if (r.status === "rejected") console.warn("[git] listing pull requests failed", r.reason);
      setLists({ all: all.value, review: review.status === "fulfilled" ? review.value : null, mine: mine.status === "fulfilled" ? mine.value : null });
    });
  };
  useEffect(load, [host]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === root) load(); };
    window.addEventListener(PR_CHANGED, on);
    return () => window.removeEventListener(PR_CHANGED, on);
  }, [host]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = lists ? groupRows(lists.all, lists.review, lists.mine, query) : null;
  const total = lists ? new Set([...lists.all, ...(lists.review ?? []), ...(lists.mine ?? [])].map((r) => r.number)).size : 0;
  const open = (r: PrRow) => { if (host) onOpen(r.number, `${host.short} ${host.sign}${r.number}`); };
  const empty = g && !g.waiting.length && !g.yours.length && !g.others.length && !g.bots.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 pb-1 pl-3 pr-2 pt-2">
        <span className="min-w-0 truncate text-[12.5px] font-medium text-text-primary">{host?.kind === "gitlab" ? "Merge requests" : "Pull requests"}</span>
        {lists && !error && <span className={countChip}>{total}</span>}
        <button onClick={load} title="Refresh" className={toolBtn + " ml-auto"}><RefreshCw size={14} /></button>
        <button onClick={onClose} title="Close" className={toolBtn}><X size={14} /></button>
      </div>
      <div className="px-2.5 pb-2">
        <label className={field + " flex h-7 items-center gap-2 px-2.5 focus-within:border-[var(--accent)]"}>
          <Search size={13} className="shrink-0 text-text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, number, author"
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted" />
        </label>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {(!lists || !host) && <p className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-text-muted"><Loader2 size={13} className="animate-spin" /> Loading…</p>}
        {error && <div className="break-words px-2.5 py-2 text-[12px] leading-relaxed text-text-muted"><ErrorText e={error} root={root} pre={false} /></div>}
        {host && g && !error && empty && (
          <p className="px-2.5 py-2 text-[12px] leading-relaxed text-text-muted">
            {query ? `No open ${host.noun}s match "${query}".` : `No open ${host.noun}s here. Create one from a branch's menu in the graph, or the PR button in its toolbar.`}
          </p>
        )}
        {host && g && (
          <>
            <Group title="Waiting for you" rows={g.waiting} accent host={host} selected={selected} onOpen={open} />
            <Group title="Yours" rows={g.yours} host={host} selected={selected} onOpen={open} />
            <Group title="Everyone else" rows={g.others} host={host} selected={selected} onOpen={open} />
            {g.bots.length > 0 && (
              <div className="mt-2">
                <button onClick={() => setBotsOpen(!botsOpen)} aria-expanded={botsOpen}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary">
                  <Bot size={14} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">Bots' updates</span>
                  <span className={countChip}>{g.bots.length}</span>
                  {botsOpen ? <ChevronDown size={13} className="text-text-muted" /> : <ChevronRight size={13} className="text-text-muted" />}
                </button>
                {/* Opened, a line each: what it is, a dot for its checks, its number. */}
                {botsOpen && g.bots.map((r) => (
                  <button key={r.number} onClick={() => open(r)} title={`${r.title}\n${r.author} · ${ago(r.updatedAt)}`}
                    className={"flex h-6 w-full items-center gap-2 rounded-md pl-8 pr-2 text-left text-[12px] transition-colors " + (selected === r.number ? "" : "hover:bg-white/5")}
                    style={selected === r.number ? { background: "var(--accent-soft)" } : undefined}>
                    <span className="size-[7px] shrink-0 rounded-full" style={{ background: STATE_COLOR[r.state] }} />
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{r.title}</span>
                    <span className="shrink-0 font-mono text-[11px] text-text-muted">{host.sign}{r.number}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A group's heading and rows; nothing at all when it has none. */
function Group({ title, rows, accent, host, selected, onOpen }: {
  title: string; rows: PrRow[]; accent?: boolean; host: PrHost; selected: number | null; onOpen: (r: PrRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <section className="mb-2">
      <h3 className={heading + " flex h-7 items-center gap-1.5 px-2"}>
        {title}
        {/* Only the group that asks something of you has its count in the accent. */}
        {accent
          ? <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] text-white" style={{ background: "var(--accent)" }}>{rows.length}</span>
          : <span className={countChip}>{rows.length}</span>}
      </h3>
      {rows.map((r) => {
        const st = rowStatus(r);
        const on = selected === r.number;
        return (
          <button key={r.number} onClick={() => onOpen(r)} title={`${r.head} → ${r.base}`}
            className={"flex w-full gap-2 rounded-md px-2 py-1.5 text-left transition-colors " + (on ? "" : "hover:bg-white/5")}
            style={on ? { background: "var(--accent-soft)" } : undefined}>
            <GitPullRequest size={13} className="shrink-0" style={{ marginTop: 2, color: r.isDraft ? "var(--text-muted)" : STATE_COLOR[r.state] }} />
            <span className="min-w-0 flex-1">
              <span className={"line-clamp-2 text-[12.5px] leading-[17px] " + (r.isDraft ? "text-text-secondary" : "text-text-primary")}>{r.title}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
                <span className="min-w-0 truncate">{host.sign}{r.number} · {r.author} · {ago(r.updatedAt)}</span>
                {st && (st.tone === "muted"
                  ? <span className="ml-auto shrink-0 rounded-full bg-elev px-1.5 text-[10.5px] text-text-secondary">{st.label}</span>
                  : <span className="ml-auto shrink-0" style={{ color: TONE[st.tone] }}>{st.label}</span>)}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
