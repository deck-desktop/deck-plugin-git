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
import { Loader2, RefreshCw, X, ExternalLink, Check, MessageSquare, GitMerge, CircleDot, LogIn } from "lucide-react";
import { openExternal } from "../shim/bridge.js";
import type { ConfirmState, IconTheme } from "../shim/ui.js";
import { Tabs } from "../shim/ui.js";
import { GIT_CHANGED } from "./WorkPanel";
import { toolBtn, field, secondaryBtn, dangerSecondaryBtn, primaryBtn, accentFill, heading, toggledOn, chipTone } from "./util";
import { mergeBlocker, PR_CHANGED, type PrDetail } from "./prs";
import { usePrHost, type Verdict } from "./prhost";
import { STATE_COLOR, ago, failWith } from "./pr/common";
import { PrFiles } from "./pr/PrFiles";

export { PrList } from "./pr/PrList";

type Tab = "overview" | "files" | "commits";
type Box = null | "review" | "merge" | "close";

/** One pull request: what it is, what it changes, and what a reviewer can do with it. */
export function PrView({ root, remote, number, theme, onConfirm, onOpenCommit }: {
  root: string; remote: string; number: number; theme: IconTheme;
  onConfirm: (s: ConfirmState) => void;
  /** A commit of the PR, for the commit panel. */
  onOpenCommit?: (oid: string) => void;
}) {
  const fail = failWith(onConfirm, root);
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

  if (!d || !host) return <div className="flex h-full items-center justify-center text-[12.5px] text-text-muted"><Loader2 size={15} className="mr-2 animate-spin" /> Loading #{number}…</div>;

  const open = d.state === "OPEN";
  const blocker = mergeBlocker(d);
  const stateBadge = d.state === "MERGED" ? ["Merged", "rgb(var(--tone-violet-400))"] : d.state === "CLOSED" ? ["Closed", "rgb(var(--tone-red-400))"]
    : d.isDraft ? ["Draft", "var(--text-muted)"] : ["Open", "rgb(var(--tone-green-400))"];
  const btnBase = "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors disabled:opacity-40";
  const btn = btnBase + " text-text-secondary hover:bg-white/5 hover:text-text-primary";
  /** A toolbar button whose box is open below it: lit as a toggle that is on. */
  const boxBtn = (b: Box) => ({ className: box === b ? btnBase + " text-text-primary" : btn, style: box === b ? toggledOn : undefined });
  /** The open action's own small form, under the buttons. */
  const card = "mt-3 space-y-2.5 rounded-lg border border-subtle p-3";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: what it is, and the actions. */}
      <div className="shrink-0 px-4 pt-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-text-primary">{d.title} <span className="font-normal text-text-muted">{host.sign}{d.number}</span></div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
              <span className="rounded-full px-1.5 py-px text-[10.5px]" style={chipTone(stateBadge[1])}>{stateBadge[0]}</span>
              <span>{d.author} wants to merge <span className="font-mono text-text-secondary">{d.head}</span> into <span className="font-mono text-text-secondary">{d.base}</span></span>
              {d.additions != null && <span className="tabular-nums"><span style={{ color: "var(--git-added)" }}>+{d.additions}</span> <span style={{ color: "var(--git-deleted)" }}>-{d.deletions}</span></span>}
            </div>
          </div>
          <button onClick={load} title="Refresh" className={toolBtn}><RefreshCw size={14} /></button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-0.5">
          {open && <button onClick={() => setBox(box === "review" ? null : "review")} {...boxBtn("review")}><Check size={13} /> Review</button>}
          {open && <button onClick={() => setBox(box === "merge" ? null : "merge")} {...boxBtn("merge")}><GitMerge size={13} /> Merge</button>}
          {open && <button onClick={() => setBox(box === "close" ? null : "close")} {...boxBtn("close")}><X size={13} /> Close</button>}
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
          <div className={card} style={{ background: "var(--bg-card)" }}>
            <div className="flex flex-wrap gap-3 text-[12px] text-text-secondary">
              {verdicts.map(({ v, label, why }) => (
                <label key={v} className={"flex items-center gap-1.5 " + (why ? "opacity-40" : "")} title={why}>
                  <input type="radio" className="accent-[var(--accent)]" checked={verdict === v} disabled={!!why} onChange={() => setVerdict(v)} /> {label}
                </label>
              ))}
            </div>
            {refused && <p className="text-[11.5px] text-text-muted">{refused}, so only a comment is possible here. Another account can approve it.</p>}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
              placeholder={verdict === "approve" || verdict === "revoke" ? "Optional message" : verdict === "comment" ? "Comment (required)" : "What should change? (required)"}
              className={field + " block resize-y px-2.5 py-1.5 leading-5"} />
            <button disabled={!!busy || ((verdict === "comment" || verdict === "request-changes") && !text.trim())}
              onClick={() => void run("Review", () => host.review(number, verdict, text.trim()))}
              className={primaryBtn} style={accentFill}>
              Submit review
            </button>
          </div>
        )}
        {box === "merge" && (
          <div className={card + " text-[12px] text-text-secondary"} style={{ background: "var(--bg-card)" }}>
            {blocker && <p style={{ color: "rgb(var(--tone-red-400))" }}>{blocker}</p>}
            {!blocker && d.checks.some((c) => c.state === "failing") && <p style={{ color: "rgb(var(--tone-amber-400))" }}>Some checks are failing.</p>}
            <div className="flex flex-wrap gap-3">
              {([["merge", "Merge commit"], ["squash", "Squash"], ["rebase", "Rebase"]] as const).map(([v, label]) => (
                <label key={v} className="flex items-center gap-1.5"><input type="radio" className="accent-[var(--accent)]" checked={method === v} onChange={() => setMethod(v)} /> {label}</label>
              ))}
            </div>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[var(--accent)]" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} /> Delete {d.head} after merging</label>
            <button disabled={!!busy || !!blocker}
              onClick={() => void run("Merge", () => host.merge(number, method, deleteBranch), true)}
              className={primaryBtn} style={accentFill}>
              <GitMerge size={13} /> Merge {host.noun}
            </button>
          </div>
        )}
        {box === "close" && (
          <div className={card} style={{ background: "var(--bg-card)" }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Why it is being closed (optional, posted as a comment)"
              className={field + " block resize-y px-2.5 py-1.5 leading-5"} />
            {/* It can be reopened, so it asks nothing; red only under the pointer. */}
            <button disabled={!!busy} onClick={() => void run("Close", () => host.close(number, text.trim()))}
              className={dangerSecondaryBtn}>
              Close {host.noun}
            </button>
          </div>
        )}

        {/* Out to the panel's edges, so the tabs' line runs across it. */}
        <div className="-mx-4 mt-3">
          <Tabs value={tab} onChange={setTab} layoutId="git-pr-tab"
            options={[{ value: "overview", label: "Overview" }, { value: "files", label: `Files (${d.changedFiles})` }, { value: "commits", label: `Commits (${d.commits.length})` }]} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "overview" && (
          <div className="scroll-thin h-full overflow-y-auto px-4 py-3">
            <div className="prose-deck text-[13px] leading-relaxed text-text-secondary">
              {d.body.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{d.body}</ReactMarkdown> : <p className="text-text-muted">No description.</p>}
            </div>

            {d.checks.length > 0 && (
              <section className="mt-5">
                <h4 className={"mb-1 " + heading}>Checks</h4>
                {d.checks.map((c, i) => (
                  <div key={i} className="flex h-6 items-center gap-2 text-[12px]">
                    <span className="size-[7px] shrink-0 rounded-full" style={{ background: STATE_COLOR[c.state] }} />
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{c.name}</span>
                    {c.url && <button onClick={() => void openExternal(c.url)} className="text-[11px] text-[var(--accent)] hover:underline">details</button>}
                  </div>
                ))}
              </section>
            )}
            {(d.requested.length > 0 || d.review) && (
              <section className="mt-5 text-[12px] text-text-secondary">
                <h4 className={"mb-1 " + heading}>Review</h4>
                {d.review && <p>{d.review.replace(/_/g, " ").toLowerCase()}</p>}
                {d.requested.length > 0 && <p>Waiting on {d.requested.join(", ")}</p>}
              </section>
            )}

            <section className="mt-5">
              <h4 className={"mb-2 " + heading}>Conversation</h4>
              {d.timeline.length === 0 && <p className="mb-2 text-[12px] text-text-muted">No comments yet. Write the first one below.</p>}
              {d.timeline.map((e, i) => (
                <div key={i} className="mb-2 rounded-lg border border-subtle px-3 py-2" style={{ background: "var(--bg-card)" }}>
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    {e.kind === "review" ? <Check size={11} /> : <MessageSquare size={11} />}
                    <span className="text-text-secondary">{e.author}</span>
                    {e.verdict && e.verdict !== "COMMENTED" && (
                      <span className="rounded-full px-1.5 py-px text-[10.5px]"
                        style={chipTone(e.verdict === "APPROVED" ? "rgb(var(--tone-green-400))" : e.verdict === "CHANGES_REQUESTED" ? "rgb(var(--tone-red-400))" : "var(--text-secondary)")}>
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
                className={field + " mt-1 block resize-y px-2.5 py-1.5 leading-5"} />
              <button disabled={!!busy || !comment.trim()} title="Ctrl+Enter"
                onClick={() => void run("Comment", () => host.comment(number, comment.trim())).then((ok) => { if (ok) setComment(""); })}
                className={secondaryBtn + " mt-1.5"}>
                <MessageSquare size={13} /> Comment
              </button>
            </section>
          </div>
        )}
        {tab === "files" && <PrFiles root={root} host={host} remote={remote} d={d} theme={theme} onConfirm={onConfirm} />}
        {tab === "commits" && (
          <div className="scroll-thin h-full overflow-y-auto px-2.5 py-1.5">
            {d.commits.map((c) => (
              <button key={c.oid} onClick={() => onOpenCommit?.(c.oid)} className="flex h-6 w-full items-center gap-3 rounded-md px-1.5 text-left text-[12px] transition-colors hover:bg-white/5">
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
