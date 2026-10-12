// Reviewing pull requests from the Git Graph: a list (PrList, in the side panel) and one pull
// request in full (PrView, in the main area) — its description, checks and conversation, its
// changed files as diffs, its commits — with the actions a reviewer takes: comment, review,
// merge, close or reopen, check out, and draft/ready.
//
// Everything goes through the repo's PrHost (prhost.ts): the GitHub CLI for GitHub, the GitLab CLI
// for GitLab's merge requests, each holding the user's sign-in. The files are diffed locally: the
// head is fetched (pull/N/head, or merge-requests/N/head, so a fork's works too) and compared from
// where it left its base, as GitHub's "Files changed" does.
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, RefreshCw, X, ExternalLink, Check, MessageSquare, GitMerge, GitPullRequest, CircleDot, LogIn, List, ListTree, Columns2, Rows2 } from "lucide-react";
import { gitMergeBase, gitRangeFiles, gitFileBytes, openExternal, type CommitFile } from "../shim/bridge.js";
import { FileIcon } from "../shim/ui.js";
import type { ConfirmState } from "../shim/ui.js";
import type { IconTheme } from "../shim/ui.js";
import { MonacoDiff, type DiffSide } from "../shim/ui.js";
import { MediaDiff, mediaKind } from "../shim/ui.js";
import { commitFileSides } from "./GitGraph";
import { GIT_CHANGED } from "./WorkPanel";
import { statusColor, buildChangeTree } from "../shim/ui.js";
import { baseName } from "./util";
import { CommitRow } from "./CommitPanel";
import { mergeBlocker, PR_CHANGED, type PrThread, type PrRow, type PrDetail, type PrState } from "./prs";
import { usePrHost, prError, type PrHost, type PrFilter, type Verdict } from "./prhost";

const STATE_COLOR: Record<PrState, string> = { passing: "#3fb950", failing: "#f85149", pending: "#d29922", none: "var(--text-muted)" };
const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return !isFinite(s) ? "" : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const failWith = (onConfirm: (s: ConfirmState) => void) => (title: string, e: unknown) => onConfirm({
  title, confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {},
  body: <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px]">{prError(e)}</pre>,
});

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
      <div className="flex items-center gap-0.5 border-b border-subtle px-2 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{host?.kind === "gitlab" ? "Merge requests" : "Pull requests"}</span>
        <button onClick={load} title="Refresh" className="vscode-toggle ml-auto"><RefreshCw size={13} /></button>
        <button onClick={onClose} title="Close" className="vscode-toggle"><X size={14} /></button>
      </div>
      <div className="flex gap-1 border-b border-subtle px-2 py-1.5">
        {([["review", "Needs my review"], ["mine", "Mine"], ["all", "All"]] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={"rounded px-2 py-0.5 text-[11px] " + (filter === f ? "bg-elev text-text-primary" : "text-text-muted hover:text-text-primary")}>
            {label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
        {(rows === null || !host) && <p className="flex items-center gap-2 px-3 py-3 text-xs text-text-muted"><Loader2 size={12} className="animate-spin" /> Loading…</p>}
        {error && <p className="px-3 py-3 text-xs text-text-muted">{error}</p>}
        {rows?.length === 0 && !error && <p className="px-3 py-3 text-xs text-text-muted">No open {host?.noun ?? "pull request"}s here.</p>}
        {host && rows?.map((r) => (
          <button key={r.number} onClick={() => onOpen(r.number, `${host.short} ${host.sign}${r.number}`)}
            className={"flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-elev " + (selected === r.number ? "bg-elev" : "")}>
            <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
              <GitPullRequest size={12} className="shrink-0" style={{ color: r.isDraft ? "var(--text-muted)" : STATE_COLOR[r.state] }} />
              <span className="truncate text-text-primary">{r.title}</span>
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

type Tab = "overview" | "files" | "commits";
type Box = null | "review" | "merge" | "close";

/** One pull request: what it is, what it changes, and what a reviewer can do with it. */
export function PrView({ root, remote, number, theme, onConfirm, onOpenCommit }: {
  root: string; remote: string; number: number; theme: IconTheme;
  onConfirm: (s: ConfirmState) => void;
  /** A commit of the PR, for the commit panel. */
  onOpenCommit?: (oid: string) => void;
}) {
  const fail = failWith(onConfirm);
  const host = usePrHost(root);
  const [d, setD] = useState<PrDetail | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState("");
  const [box, setBox] = useState<Box>(null);
  const [text, setText] = useState("");            // the review / close / comment text
  const [verdict, setVerdict] = useState<Verdict>("approve");
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("merge");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [comment, setComment] = useState("");

  const load = () => {
    if (!host) return;
    void host.view(number)
      .then((v) => { if (!v) throw new Error(`No ${host.noun} ${host.sign}${number} here.`); setD(v); })
      .catch((e) => fail(`Could not load ${host.sign}${number}`, e));
  };
  useEffect(() => { setD(null); setTab("overview"); setBox(null); load(); }, [host, number]); // eslint-disable-line react-hooks/exhaustive-deps

  // What a review can say here: GitHub's three, or GitLab's approve-or-revoke and comment; one the
  // host will refuse (your own pull request, say) comes with why.
  const [verdicts, setVerdicts] = useState<{ v: Verdict; label: string; why?: string }[]>([]);
  useEffect(() => {
    if (!host || !d) return;
    let alive = true;
    void host.verdicts(d).then((vs) => {
      if (!alive) return;
      setVerdicts(vs);
      setVerdict((cur) => (vs.some((x) => x.v === cur && !x.why) ? cur : vs.find((x) => !x.why)?.v ?? "comment"));
    });
    return () => { alive = false; };
    // Not on `d` itself: every action re-reads it as a new object, and GitHub's answer costs a
    // `gh pr list` (whether it is yours). Approving is the one thing that changes it.
  }, [host, d?.number, d?.approvedByMe]); // eslint-disable-line react-hooks/exhaustive-deps
  const refused = verdicts.find((x) => x.why)?.why;

  /** A host action; then re-read it, and tell the graph when the repo itself moved. */
  const run = async (label: string, act: () => Promise<unknown>, repoMoved = false): Promise<boolean> => {
    setBusy(label);
    let ok = false;
    try {
      await act();
      setBox(null); setText("");
      if (repoMoved) window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root }));
      window.dispatchEvent(new CustomEvent(PR_CHANGED, { detail: root }));
      load();
      ok = true;
    } catch (e) { fail(`${label} failed`, e); }
    setBusy("");
    return ok;
  };

  if (!d || !host) return <div className="flex h-full items-center justify-center text-sm text-text-muted"><Loader2 size={16} className="mr-2 animate-spin" /> Loading #{number}…</div>;

  const open = d.state === "OPEN";
  const blocker = mergeBlocker(d);
  const stateBadge = d.state === "MERGED" ? ["Merged", "#a371f7"] : d.state === "CLOSED" ? ["Closed", "#f85149"] : d.isDraft ? ["Draft", "var(--text-muted)"] : ["Open", "#3fb950"];
  const btn = "flex items-center gap-1.5 rounded px-2 py-1 text-[12px] text-text-secondary hover:bg-white/5 hover:text-text-primary disabled:opacity-40";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: what it is, and the actions. */}
      <div className="shrink-0 border-b border-subtle px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-text-primary">{d.title} <span className="font-normal text-text-muted">{host.sign}{d.number}</span></div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: stateBadge[1] }}>{stateBadge[0]}</span>
              <span>{d.author} wants to merge <span className="font-mono text-text-secondary">{d.head}</span> into <span className="font-mono text-text-secondary">{d.base}</span></span>
              {d.additions != null && <span><span style={{ color: "#3fb950" }}>+{d.additions}</span> <span style={{ color: "#f85149" }}>-{d.deletions}</span></span>}
            </div>
          </div>
          <button onClick={load} title="Refresh" className="vscode-toggle"><RefreshCw size={13} /></button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {open && <button onClick={() => setBox(box === "review" ? null : "review")} className={btn}><Check size={13} /> Review</button>}
          {open && <button onClick={() => setBox(box === "merge" ? null : "merge")} className={btn}><GitMerge size={13} /> Merge</button>}
          {open && <button onClick={() => setBox(box === "close" ? null : "close")} className={btn}><X size={13} /> Close</button>}
          {d.state === "CLOSED" && <button disabled={!!busy} onClick={() => void run("Reopen", () => host.reopen(number))} className={btn}><CircleDot size={13} /> Reopen</button>}
          {open && <button disabled={!!busy} onClick={() => void run("Check out", () => host.checkout(number), true)} className={btn} title={`Check out the ${host.noun}'s branch here, to run it`}><LogIn size={13} /> Check out</button>}
          {open && (d.isDraft
            ? <button disabled={!!busy} onClick={() => void run("Mark ready", () => host.setDraft(number, false))} className={btn}>Ready for review</button>
            : <button disabled={!!busy} onClick={() => void run("Convert to draft", () => host.setDraft(number, true))} className={btn}>Convert to draft</button>)}
          <a href={d.url} onClick={(e) => { e.preventDefault(); void openExternal(d.url); }} className={btn}><ExternalLink size={13} /> {host.name}</a>
          {busy && <span className="flex items-center gap-1 text-[11px] text-text-muted"><Loader2 size={12} className="animate-spin" /> {busy}…</span>}
        </div>

        {/* The open action's own small form, under the buttons. */}
        {box === "review" && (
          <div className="mt-3 space-y-2 rounded-md border border-subtle p-3">
            <div className="flex gap-3 text-[12px] text-text-secondary">
              {verdicts.map(({ v, label, why }) => (
                <label key={v} className={"flex items-center gap-1.5 " + (why ? "opacity-40" : "")} title={why}>
                  <input type="radio" checked={verdict === v} disabled={!!why} onChange={() => setVerdict(v)} /> {label}
                </label>
              ))}
            </div>
            {refused && <p className="text-[11px] text-text-muted">{refused}, so only a comment is possible here. Another account can approve it.</p>}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
              placeholder={verdict === "approve" || verdict === "revoke" ? "Optional message" : verdict === "comment" ? "Comment (required)" : "What should change? (required)"}
              className="vscode-input w-full resize-y px-2 py-1 text-[12px]" />
            <button disabled={!!busy || ((verdict === "comment" || verdict === "request-changes") && !text.trim())}
              onClick={() => void run("Review", () => host.review(number, verdict, text.trim()))}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--accent)" }}>
              Submit review
            </button>
          </div>
        )}
        {box === "merge" && (
          <div className="mt-3 space-y-2 rounded-md border border-subtle p-3 text-[12px] text-text-secondary">
            {blocker && <p style={{ color: "var(--danger)" }}>{blocker}</p>}
            {!blocker && d.checks.some((c) => c.state === "failing") && <p style={{ color: "#d29922" }}>Some checks are failing.</p>}
            <div className="flex gap-3">
              {([["merge", "Merge commit"], ["squash", "Squash"], ["rebase", "Rebase"]] as const).map(([v, label]) => (
                <label key={v} className="flex items-center gap-1.5"><input type="radio" checked={method === v} onChange={() => setMethod(v)} /> {label}</label>
              ))}
            </div>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} /> Delete {d.head} after merging</label>
            <button disabled={!!busy || !!blocker}
              onClick={() => void run("Merge", () => host.merge(number, method, deleteBranch), true)}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40" style={{ background: "#238636" }}>
              Merge {host.noun}
            </button>
          </div>
        )}
        {box === "close" && (
          <div className="mt-3 space-y-2 rounded-md border border-subtle p-3">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Why it is being closed (optional, posted as a comment)"
              className="vscode-input w-full resize-y px-2 py-1 text-[12px]" />
            <button disabled={!!busy} onClick={() => void run("Close", () => host.close(number, text.trim()))}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "var(--danger)" }}>
              Close {host.noun}
            </button>
          </div>
        )}

        <div className="mt-3 flex gap-1">
          {([["overview", "Overview"], ["files", `Files (${d.changedFiles})`], ["commits", `Commits (${d.commits.length})`]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={"rounded px-2.5 py-1 text-[12px] " + (tab === t ? "bg-elev text-text-primary" : "text-text-muted hover:text-text-primary")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "overview" && (
          <div className="scroll-thin h-full overflow-y-auto px-4 py-3">
            <div className="prose-deck text-[13px] leading-relaxed text-text-secondary">
              {d.body.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{d.body}</ReactMarkdown> : <p className="italic text-text-muted">No description.</p>}
            </div>

            {d.checks.length > 0 && (
              <section className="mt-4">
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Checks</h4>
                {d.checks.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5 text-[12px]">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: STATE_COLOR[c.state] }} />
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{c.name}</span>
                    {c.url && <button onClick={() => void openExternal(c.url)} className="text-[11px] text-[var(--accent)] hover:underline">details</button>}
                  </div>
                ))}
              </section>
            )}
            {(d.requested.length > 0 || d.review) && (
              <section className="mt-4 text-[12px] text-text-secondary">
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Review</h4>
                {d.review && <p>{d.review.replace(/_/g, " ").toLowerCase()}</p>}
                {d.requested.length > 0 && <p>Waiting on {d.requested.join(", ")}</p>}
              </section>
            )}

            <section className="mt-4">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Conversation</h4>
              {d.timeline.length === 0 && <p className="text-[12px] text-text-muted">Nothing yet.</p>}
              {d.timeline.map((e, i) => (
                <div key={i} className="mb-2 rounded-md border border-subtle px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    {e.kind === "review" ? <Check size={11} /> : <MessageSquare size={11} />}
                    <span className="text-text-secondary">{e.author}</span>
                    {e.verdict && e.verdict !== "COMMENTED" && (
                      <span style={{ color: e.verdict === "APPROVED" ? "#3fb950" : e.verdict === "CHANGES_REQUESTED" ? "#f85149" : undefined }}>
                        {e.verdict.replace(/_/g, " ").toLowerCase()}
                      </span>
                    )}
                    <span className="ml-auto">{ago(e.at)}</span>
                  </div>
                  {e.body.trim() && <div className="prose-deck mt-1 text-[12px] text-text-secondary"><ReactMarkdown remarkPlugins={[remarkGfm]}>{e.body}</ReactMarkdown></div>}
                </div>
              ))}
              <textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={3} placeholder="Leave a comment"
                onKeyDown={(ev) => { if (ev.key === "Enter" && ev.ctrlKey && comment.trim()) { void run("Comment", () => host.comment(number, comment.trim())).then((ok) => { if (ok) setComment(""); }); } }}
                className="vscode-input mt-1 w-full resize-y px-2 py-1 text-[12px]" />
              <button disabled={!!busy || !comment.trim()} title="Ctrl+Enter"
                onClick={() => void run("Comment", () => host.comment(number, comment.trim())).then((ok) => { if (ok) setComment(""); })}
                className="mt-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--accent)" }}>
                Comment
              </button>
            </section>
          </div>
        )}
        {tab === "files" && <PrFiles root={root} host={host} remote={remote} d={d} theme={theme} onConfirm={onConfirm} />}
        {tab === "commits" && (
          <div className="scroll-thin h-full overflow-y-auto py-1">
            {d.commits.map((c) => (
              <button key={c.oid} onClick={() => onOpenCommit?.(c.oid)} className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-[12px] hover:bg-elev">
                <span className="font-mono text-text-muted">{c.oid.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 truncate text-text-primary">{c.headline}</span>
                <span className="shrink-0 text-text-muted">{c.author} · {ago(c.at)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The PR's changed files, diffed here: its head fetched, compared from where it left its base.
 * A list on the left, the selected file's diff on the right.
 */
// The file list's shape and the diff's layout, per machine — the same choice every PR gets.
const TREE_KEY = "deck-pr-files-tree", SPLIT_KEY = "deck-pr-diff-split";
const loadFlag = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v === "1"; } catch { return fallback; } };
const saveFlag = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* private mode */ } };

function PrFiles({ root, host, remote, d, theme, onConfirm }: { root: string; host: PrHost; remote: string; d: PrDetail; theme: IconTheme; onConfirm: (s: ConfirmState) => void }) {
  const fail = failWith(onConfirm);
  const [tree, setTree] = useState(() => loadFlag(TREE_KEY, true));
  // Side by side unless chosen otherwise here: a review reads old against new, and the editor's
  // inline preference is about its own diffs.
  const [sideBySide, setSideBySide] = useState(() => loadFlag(SPLIT_KEY, true));
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [from, setFrom] = useState("");
  const [error, setError] = useState("");
  const [pick, setPick] = useState<CommitFile | null>(null);
  const [sides, setSides] = useState<{ base: string; mod: string; media?: { old: Uint8Array; nu: Uint8Array } } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // The head may only exist on the host (a fork, or not fetched yet).
      await host.fetchHead(remote, d.number, d.base).catch(() => {});
      const base = await gitMergeBase(root, d.baseOid, d.headOid).catch(() => d.baseOid);
      const list = await gitRangeFiles(root, base, d.headOid).catch((e) => { if (alive) setError(String(e)); return [] as CommitFile[]; });
      if (!alive) return;
      // The host says files changed and git found none here: the commits are not local (offline,
      // or the fetch was refused). Saying "no changed files" would be wrong.
      if (!list.length && d.changedFiles > 0) setError(`${host.name} lists ${d.changedFiles} changed file${d.changedFiles === 1 ? "" : "s"}, but the ${host.noun}'s commits could not be fetched here. Check the connection or the remote's credentials, then refresh.`);
      setFrom(base); setFiles(list); setPick(list[0] ?? null);
    })();
    return () => { alive = false; };
  }, [root, host, remote, d.number, d.base, d.baseOid, d.headOid]);

  useEffect(() => {
    if (!pick || !from) return;
    let alive = true;
    setSides(null);
    void (async () => {
      if (mediaKind(pick.rel)) {
        const [nu, old] = await Promise.all([
          gitFileBytes(root, d.headOid, pick.rel).catch(() => new Uint8Array()),
          gitFileBytes(root, from, pick.rel).catch(() => new Uint8Array()),
        ]);
        if (alive) setSides({ base: "", mod: "", media: { old, nu } });
        return;
      }
      const { base, mod } = await commitFileSides(root, d.headOid, from, pick);
      if (alive) setSides({ base, mod });
    })();
    return () => { alive = false; };
  }, [root, pick, from, d.headOid]);

  // ---- Line comments: the PR's review threads, a new one being written, and replies.
  const [threads, setThreads] = useState<PrThread[]>([]);
  const [showComments, setShowComments] = useState(true);
  const [compose, setCompose] = useState<{ line: number; side: DiffSide; other: number | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<{ line: number; side: DiffSide; n: number } | undefined>();
  const [sending, setSending] = useState(false);
  const loadThreads = () => host.threads(d).then(setThreads).catch(() => setThreads([]));
  useEffect(() => { void loadThreads(); }, [host, d.number, d.headOid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCompose(null); setDraft(""); }, [pick?.rel]);
  /** A thread action, then the threads re-read. False when it failed (the dialog says why). */
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setSending(true);
    try { await fn(); await loadThreads(); return true; }
    catch (e) { fail(label, e); return false; }
    finally { setSending(false); }
  };
  const fileThreads = pick ? threads.filter((t) => t.path === pick.rel)
    .sort((a, b) => (a.line ?? a.originalLine ?? 0) - (b.line ?? b.originalLine ?? 0)) : [];
  const commentable = !!pick && !mediaKind(pick.rel);

  const threadCard = (t: PrThread) => (
    <div key={t.id} className={"mb-2 rounded-md border border-subtle " + (t.resolved ? "opacity-60" : "")}>
      <button onClick={() => { if (t.line) setReveal({ line: t.line, side: t.side, n: Date.now() }); }}
        title={t.line ? "Show this line" : "The code under it has changed since"}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-text-muted hover:text-text-primary">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: t.resolved ? "var(--text-muted)" : "var(--accent)" }} />
        {t.line ? `Line ${t.line}` : `Line ${t.originalLine ?? "?"} · outdated`}
        {t.side === "LEFT" && <span>· old version</span>}
        {t.resolved && <span className="ml-auto">resolved</span>}
      </button>
      {t.comments.map((c) => (
        <div key={c.id} className="border-t border-subtle px-2 py-1.5">
          <div className="text-[11px] text-text-muted"><span className="text-text-secondary">{c.author}</span> · {ago(c.at)}</div>
          <div className="prose-deck text-[12px] text-text-secondary"><ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown></div>
        </div>
      ))}
      <div className="border-t border-subtle p-2">
        <textarea value={replies[t.id] ?? ""} onChange={(e) => setReplies({ ...replies, [t.id]: e.target.value })} rows={2} placeholder="Reply"
          className="vscode-input w-full resize-y px-2 py-1 text-[12px]" />
        <div className="mt-1 flex gap-1.5">
          <button disabled={sending || !(replies[t.id] ?? "").trim()}
            onClick={() => void act("Reply failed", () => host.reply(d, t.id, replies[t.id].trim())).then((ok) => { if (ok) setReplies({ ...replies, [t.id]: "" }); })}
            className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--accent)" }}>Reply</button>
          <button disabled={sending} onClick={() => void act(t.resolved ? "Unresolve failed" : "Resolve failed", () => host.resolve(d, t.id, !t.resolved))}
            className="rounded border border-subtle px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40">
            {t.resolved ? "Unresolve" : "Resolve"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!files) return <div className="flex h-full items-center justify-center text-sm text-text-muted"><Loader2 size={16} className="mr-2 animate-spin" /> Fetching the pull request…</div>;
  if (error && !files.length) return <div className="p-4 text-[12px] text-text-muted">{error}</div>;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-r border-subtle">
        <div className="flex h-7 shrink-0 items-center gap-1 border-b border-subtle px-2 text-[11px] text-text-muted">
          <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
          <button onClick={() => { setTree(!tree); saveFlag(TREE_KEY, !tree); }} title={tree ? "View as List" : "View as Tree"} className="vscode-toggle ml-auto">
            {tree ? <List size={13} /> : <ListTree size={13} />}
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1 py-1 text-[12px]">
          {tree
            ? buildChangeTree(files).map((n, i) => <CommitRow key={i} node={n} depth={0} theme={theme} onOpen={setPick} activeRel={pick?.rel} />)
            : files.map((f) => (
              <button key={f.rel} onClick={() => setPick(f)} title={f.rel}
                className={"flex h-[22px] w-full items-center gap-1.5 rounded px-1 text-left hover:bg-elev " + (pick?.rel === f.rel ? "bg-elev" : "")}>
                <FileIcon icon={theme.file(baseName(f.rel))} size={16} />
                <span className="min-w-0 flex-1 truncate" style={{ color: statusColor(f.letter) }}>{baseName(f.rel)}</span>
                <span className="shrink-0 text-[10px]"><span style={{ color: "#3fb950" }}>+{f.adds}</span> <span style={{ color: "#f85149" }}>-{f.dels}</span></span>
              </button>
            ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {pick && (
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-subtle px-3 text-[11px] text-text-muted">
            <span className="min-w-0 flex-1 truncate font-mono" title={pick.rel}>{pick.rel}</span>
            <span><span style={{ color: "#3fb950" }}>+{pick.adds}</span> <span style={{ color: "#f85149" }}>-{pick.dels}</span></span>
            {commentable && (
              <button onClick={() => setShowComments(!showComments)} title="Line comments on this file"
                className={"flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-text-primary " + (showComments ? "text-text-primary" : "")}>
                <MessageSquare size={12} /> Comments{fileThreads.length ? ` (${fileThreads.length})` : ""}
              </button>
            )}
            {!mediaKind(pick.rel) && (
              <button onClick={() => { setSideBySide(!sideBySide); saveFlag(SPLIT_KEY, !sideBySide); }}
                title={sideBySide ? "Show inline" : "Show side by side"}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-text-primary">
                {sideBySide ? <><Rows2 size={12} /> Inline</> : <><Columns2 size={12} /> Side by side</>}
              </button>
            )}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
        {!pick ? <div className="p-4 text-[12px] text-text-muted">No changed files.</div>
          : !sides ? <div className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-text-muted" /></div>
          : sides.media
            ? <MediaDiff key={pick.rel} path={pick.rel} oldBytes={sides.media.old} newBytes={sides.media.nu} gone={false} oldLabel={d.base} newLabel={d.head} />
            : <MonacoDiff key={`${pick.rel}:${sideBySide}`} path={`pr${d.number}:${pick.rel}`} head={sides.base} work={sides.mod} sideBySide={sideBySide} readOnly rev={0} onChange={() => {}}
                lineComments={{
                  marks: fileThreads.filter((t) => t.line != null).map((t) => ({ line: t.line!, side: t.side, resolved: t.resolved })),
                  onPick: (line, side, other) => { setCompose({ line, side, other }); setShowComments(true); },
                  reveal,
                }} />}
        </div>
        {commentable && showComments && (
          <div className="scroll-thin w-[300px] shrink-0 overflow-y-auto border-l border-subtle p-2">
            {compose ? (
              <div className="mb-2 rounded-md border p-2" style={{ borderColor: "var(--accent)" }}
                onKeyDown={(e) => { if (e.key === "Escape") setCompose(null); }}>
                <div className="mb-1 text-[11px] text-text-muted">
                  New comment on line {compose.line} · {compose.side === "LEFT" ? "old" : "new"} version
                </div>
                <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="Comment"
                  className="vscode-input w-full resize-y px-2 py-1 text-[12px]" />
                <div className="mt-1 flex gap-1.5">
                  <button disabled={sending || !draft.trim()}
                    onClick={() => void act("Comment failed", () => host.lineComment(d, pick!.rel, compose.line, compose.side, compose.other, draft.trim()))
                      .then((ok) => { if (ok) { setCompose(null); setDraft(""); } })}
                    className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--accent)" }}>
                    {sending ? "Posting…" : "Comment"}
                  </button>
                  <button onClick={() => setCompose(null)} className="rounded border border-subtle px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary">Cancel</button>
                </div>
              </div>
            ) : (
              // The host takes comments only on lines the change touched or shows around them.
              <p className="mb-2 text-[11px] text-text-muted">Click a line number in the diff to comment on that line.</p>
            )}
            {fileThreads.map(threadCard)}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
