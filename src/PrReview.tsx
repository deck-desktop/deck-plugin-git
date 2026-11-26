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
import { Loader2, RefreshCw, MessageSquare, ArrowRight } from "lucide-react";
import type { ConfirmState, IconTheme } from "../shim/ui.js";
import { Tabs } from "../shim/ui.js";
import { GIT_CHANGED } from "./WorkPanel";
import { toolBtn, field, secondaryBtn, heading, chipTone } from "./util";
import { PR_CHANGED, type PrDetail } from "./prs";
import { usePrHost, type Verdict } from "./prhost";
import { Person, pictureOf } from "./pr/Person";
import { TONE, ago, failWith } from "./pr/common";
import { PrFiles } from "./pr/PrFiles";
import { PrActions } from "./pr/PrActions";
import { PrSide } from "./pr/PrSide";
import { primaryAction } from "./pr/status";
import { detailCache, verdictCache, prKey, type Verdicts } from "./pr/cache";

export { PrList } from "./pr/PrList";

type Tab = "overview" | "files" | "commits";

/** One pull request: what it is, what it changes, and what a reviewer can do with it. */
export function PrView({ root, remote, number, theme, onConfirm, onOpenCommit }: {
  root: string; remote: string; number: number; theme: IconTheme;
  onConfirm: (s: ConfirmState) => void;
  /** A commit of the PR, for the commit panel. */
  onOpenCommit?: (oid: string) => void;
}) {
  const fail = failWith(onConfirm, root);
  const host = usePrHost(root);
  const [d, setD] = useState<PrDetail | null>(() => detailCache.get(prKey(root, number)) ?? null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState("");

  const load = () => {
    if (!host) return;
    setLoading(true);
    void host.view(number)
      .then((v) => { if (!v) throw new Error(`No ${host.noun} ${host.sign}${number} here.`); detailCache.set(prKey(root, number), v); setD(v); })
      .catch((e) => fail(`Could not load ${host.sign}${number}`, e))
      .finally(() => setLoading(false));
  };
  useEffect(() => { setD(detailCache.get(prKey(root, number)) ?? null); setTab("overview"); load(); }, [host, number]); // eslint-disable-line react-hooks/exhaustive-deps

  // What a review can say here: GitHub's three, or GitLab's approve-or-revoke and comment; one the
  // host will refuse (your own pull request, say) comes with why. Null until asked: the header
  // offers no action until then, rather than one that changes under the pointer.
  const [verdicts, setVerdicts] = useState<Verdicts | null>(() => verdictCache.get(prKey(root, number)) ?? null);
  useEffect(() => {
    if (!host || !d) return;
    let alive = true;
    void host.verdicts(d).then((vs) => { verdictCache.set(prKey(root, d.number), vs); if (alive) setVerdicts(vs); }, (e) => { console.warn("[git] asking what a review can say failed", e); if (alive) setVerdicts([]); });
    return () => { alive = false; };
    // Not on `d` itself: every action re-reads it as a new object, and GitHub's answer costs a
    // `gh pr list` (whether it is yours). Approving is the one thing that changes it.
  }, [host, d?.number, d?.approvedByMe]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setVerdicts(verdictCache.get(prKey(root, number)) ?? null); }, [root, number]);

  /** A host action; then re-read it, and tell the graph when the repo itself moved. */
  const run = async (label: string, act: () => Promise<unknown>, repoMoved = false): Promise<boolean> => {
    setBusy(label);
    let ok = false;
    try {
      await act();
      if (repoMoved) window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root }));
      window.dispatchEvent(new CustomEvent(PR_CHANGED, { detail: root }));
      load();
      ok = true;
    } catch (e) { fail(`${label} failed`, e); }
    setBusy("");
    return ok;
  };
  const sendComment = () => void run("Comment", () => host!.comment(number, comment.trim())).then((ok) => { if (ok) setComment(""); });

  if (!d || !host) return <div className="flex h-full items-center justify-center text-[12.5px] text-text-muted"><Loader2 size={15} className="mr-2 animate-spin" /> Loading #{number}…</div>;

  const stateBadge = d.state === "MERGED" ? ["Merged", "rgb(var(--tone-violet-400))"] : d.state === "CLOSED" ? ["Closed", TONE.bad]
    : d.isDraft ? ["Draft", "var(--text-muted)"] : ["Open", TONE.ok];
  const canApprove = verdicts ? verdicts.some((x) => x.v === "approve" && !x.why) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: what it is on the left, the one thing to do on the right. */}
      <div className="shrink-0 px-6 pt-4">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0" style={{ flex: "1 1 280px" }}>
            <div className="text-[16px] font-semibold text-text-primary" style={{ lineHeight: "24px" }}>
              <span className="mr-2 inline-block rounded-full px-2 py-px text-[11px] font-medium" style={{ ...chipTone(stateBadge[1]), verticalAlign: 3 }}>{stateBadge[0]}</span>
              {d.title} <span className="font-normal text-text-muted">{host.sign}{d.number}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-text-muted">
              <span className="flex items-center gap-1.5"><Person name={d.author} url={pictureOf(host, d.author, d.avatars?.[d.author])} size={18} /><span className="text-text-secondary">{d.author}</span></span>
              <span className="flex h-[22px] items-center gap-1.5 rounded-md border border-subtle bg-elev px-2 font-mono text-[11.5px] text-text-secondary" title={`${d.head} into ${d.base}`}>
                <span className="min-w-0 truncate">{d.head}</span><ArrowRight size={11} className="shrink-0 text-text-muted" /><span className="shrink-0">{d.base}</span>
              </span>
              {d.additions != null && <span className="tabular-nums"><span style={{ color: "var(--git-added)" }}>+{d.additions}</span> <span style={{ color: "var(--git-deleted)" }}>−{d.deletions}</span></span>}
              <button onClick={load} title={loading ? "Refreshing…" : "Refresh"} className={toolBtn}><RefreshCw size={13} className={loading ? "animate-spin" : undefined} /></button>
            </div>
          </div>
          <PrActions key={d.number} d={d} host={host} primary={primaryAction(d, canApprove)} verdicts={verdicts ?? []} busy={busy} run={run} />
        </div>

        {/* Out to the panel's edges, so the tabs' line runs across it. */}
        <div className="-mx-6 mt-3">
          <Tabs value={tab} onChange={setTab} layoutId="git-pr-tab"
            options={[{ value: "overview", label: "Overview" }, { value: "files", label: `Files (${d.changedFiles})` }, { value: "commits", label: `Commits (${d.commits.length})` }]} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "overview" && (
          <div className="scroll-thin h-full overflow-y-auto px-6 py-5">
            {/* Reversed, so where the two do not fit side by side, what decides the merge comes first. */}
            <div className="flex flex-wrap items-start justify-end gap-6" style={{ flexDirection: "row-reverse" }}>
              <PrSide d={d} host={host} />
              {/* The description at a width that reads, and the conversation under it. */}
              <article className="min-w-0" style={{ flex: "999 1 360px", maxWidth: 760 }}>
                <div className="prose-deck text-[13px] leading-relaxed text-text-secondary">
                  {d.body.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{d.body}</ReactMarkdown> : <p className="text-text-muted">No description.</p>}
                </div>

                <section className="mt-6">
                  <h4 className={"mb-3 " + heading}>Conversation</h4>
                  {d.timeline.length === 0 && <p className="mb-3 text-[12px] text-text-muted">No comments yet. Write the first one below.</p>}
                  <div className="space-y-4">
                    {d.timeline.map((e, i) => (
                      <div key={i} className="flex gap-2.5">
                        <Person name={e.author} url={pictureOf(host, e.author, d.avatars?.[e.author])} size={24} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[11.5px] text-text-muted">
                            <span className="font-medium text-text-primary">{e.author}</span>
                            {e.verdict && e.verdict !== "COMMENTED" && (
                              <span className="rounded-full px-1.5 py-px text-[10.5px]"
                                style={chipTone(e.verdict === "APPROVED" ? TONE.ok : e.verdict === "CHANGES_REQUESTED" ? TONE.bad : "var(--text-secondary)")}>
                                {e.verdict.replace(/_/g, " ").toLowerCase()}
                              </span>
                            )}
                            <span>{ago(e.at)}</span>
                          </div>
                          {e.body.trim() && <div className="prose-deck mt-1 text-[12.5px] text-text-secondary"><ReactMarkdown remarkPlugins={[remarkGfm]}>{e.body}</ReactMarkdown></div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-lg border border-subtle bg-elev focus-within:border-[var(--accent)]">
                    <textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} placeholder="Leave a comment" aria-label="Leave a comment"
                      onKeyDown={(ev) => { if (ev.key === "Enter" && ev.ctrlKey && comment.trim()) sendComment(); }}
                      className={field + " block resize-y border-0 bg-transparent px-3 py-2 leading-5"} />
                    <div className="flex items-center justify-end gap-2.5 px-2 pb-2">
                      <span className="text-[11px] text-text-muted">Ctrl+Enter</span>
                      <button disabled={!!busy || !comment.trim()} onClick={sendComment} className={secondaryBtn}>
                        <MessageSquare size={13} /> Comment
                      </button>
                    </div>
                  </div>
                </section>
              </article>
            </div>
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
