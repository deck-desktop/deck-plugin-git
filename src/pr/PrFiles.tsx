// A pull request's changed files and its line comments (PrView's Files tab).
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, MessageSquare, List, ListTree, Columns2, Rows2 } from "lucide-react";
import { gitRangeFiles, gitFileBytes, type CommitFile } from "../../shim/bridge.js";
import { gitMergeBase } from "../git";
import { FileIcon, MonacoDiff, MediaDiff, mediaKind, statusColor, buildChangeTree, type ConfirmState, type IconTheme, type DiffSide } from "../../shim/ui.js";
import { commitFileSides } from "../GitGraph";
import { CommitRow } from "../CommitPanel";
import { baseName, toolBtn, field, accentFill, toggledOn } from "../util";
import type { PrThread, PrDetail } from "../prs";
import type { PrHost } from "../prhost";
import { ErrorText } from "../ErrorText";
import { ago, failWith, smallBtn, smallPrimary } from "./common";


/**
 * The PR's changed files, diffed here: its head fetched, compared from where it left its base.
 * A list on the left, the selected file's diff on the right.
 */
// The file list's shape and the diff's layout, per machine — the same choice every PR gets.
const TREE_KEY = "deck-pr-files-tree", SPLIT_KEY = "deck-pr-diff-split";
const loadFlag = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v === "1"; } catch { return fallback; } };
const saveFlag = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* private mode */ } };

export function PrFiles({ root, host, remote, d, theme, onConfirm }: { root: string; host: PrHost; remote: string; d: PrDetail; theme: IconTheme; onConfirm: (s: ConfirmState) => void }) {
  const fail = failWith(onConfirm, root);
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
  const loadThreads = () => host.threads(d).then(setThreads).catch((e) => { console.warn("[git] review threads load failed", e); setThreads([]); });
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
    <div key={t.id} className={"mb-2 overflow-hidden rounded-lg border border-subtle " + (t.resolved ? "opacity-60" : "")} style={{ background: "var(--bg-card)" }}>
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
          className={field + " block resize-y px-2.5 py-1.5 leading-5"} />
        <div className="mt-1.5 flex gap-1.5">
          <button disabled={sending || !(replies[t.id] ?? "").trim()}
            onClick={() => void act("Reply failed", () => host.reply(d, t.id, replies[t.id].trim())).then((ok) => { if (ok) setReplies({ ...replies, [t.id]: "" }); })}
            className={smallBtn}>Reply</button>
          <button disabled={sending} onClick={() => void act(t.resolved ? "Unresolve failed" : "Resolve failed", () => host.resolve(d, t.id, !t.resolved))}
            className={smallBtn}>
            {t.resolved ? "Unresolve" : "Resolve"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!files) return <div className="flex h-full items-center justify-center text-[12.5px] text-text-muted"><Loader2 size={15} className="mr-2 animate-spin" /> Fetching the pull request…</div>;
  if (error && !files.length) return <div className="p-4 text-[12px] leading-relaxed text-text-muted"><ErrorText e={error} root={root} pre={false} /></div>;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-r border-subtle bg-panel">
        <div className="flex h-9 shrink-0 items-center gap-1 pl-3 pr-1.5 text-[11.5px] text-text-muted">
          <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
          <button onClick={() => { setTree(!tree); saveFlag(TREE_KEY, !tree); }} title={tree ? "View as List" : "View as Tree"} className={toolBtn + " ml-auto"}>
            {tree ? <List size={14} /> : <ListTree size={14} />}
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {tree
            ? buildChangeTree(files).map((n, i) => <CommitRow key={i} node={n} depth={0} theme={theme} onOpen={setPick} activeRel={pick?.rel} />)
            : files.map((f) => (
              <button key={f.rel} onClick={() => setPick(f)} title={f.rel}
                className={"flex h-6 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[12.5px] transition-colors " + (pick?.rel === f.rel ? "" : "hover:bg-white/5")}
                style={pick?.rel === f.rel ? { background: "var(--accent-soft)" } : undefined}>
                <FileIcon icon={theme.file(baseName(f.rel))} size={15} />
                <span className="min-w-0 flex-1 truncate" style={{ color: statusColor(f.letter) }}>{baseName(f.rel)}</span>
                <span className="shrink-0 text-[10.5px] tabular-nums"><span style={{ color: "var(--git-added)" }}>+{f.adds}</span> <span style={{ color: "var(--git-deleted)" }}>-{f.dels}</span></span>
              </button>
            ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {pick && (
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-subtle pl-3 pr-1.5 text-[11.5px] text-text-muted">
            <span className="min-w-0 flex-1 truncate font-mono" title={pick.rel}>{pick.rel}</span>
            <span className="mr-1 tabular-nums"><span style={{ color: "var(--git-added)" }}>+{pick.adds}</span> <span style={{ color: "var(--git-deleted)" }}>-{pick.dels}</span></span>
            {commentable && (
              <button onClick={() => setShowComments(!showComments)} title="Line comments on this file" aria-pressed={showComments}
                className={"flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 transition-colors " + (showComments ? "text-text-primary" : "hover:bg-white/5 hover:text-text-primary")}
                style={showComments ? toggledOn : undefined}>
                <MessageSquare size={13} /> Comments{fileThreads.length ? ` (${fileThreads.length})` : ""}
              </button>
            )}
            {!mediaKind(pick.rel) && (
              <button onClick={() => { setSideBySide(!sideBySide); saveFlag(SPLIT_KEY, !sideBySide); }}
                title={sideBySide ? "Show inline" : "Show side by side"}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-white/5 hover:text-text-primary">
                {sideBySide ? <><Rows2 size={13} /> Inline</> : <><Columns2 size={13} /> Side by side</>}
              </button>
            )}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
        {!pick ? <div className="p-4 text-[12px] text-text-muted">This {host.noun} changes no files.</div>
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
          <div className="scroll-thin w-[300px] shrink-0 overflow-y-auto border-l border-subtle bg-panel p-2">
            {compose ? (
              <div className="mb-2 rounded-lg border p-2" style={{ borderColor: "var(--accent)", background: "var(--bg-card)" }}
                onKeyDown={(e) => { if (e.key === "Escape") setCompose(null); }}>
                <div className="mb-1.5 text-[11px] text-text-muted">
                  New comment on line {compose.line} · {compose.side === "LEFT" ? "old" : "new"} version
                </div>
                <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="Comment"
                  className={field + " block resize-y px-2.5 py-1.5 leading-5"} />
                <div className="mt-1.5 flex gap-1.5">
                  <button disabled={sending || !draft.trim()}
                    onClick={() => void act("Comment failed", () => host.lineComment(d, pick!.rel, compose.line, compose.side, compose.other, draft.trim()))
                      .then((ok) => { if (ok) { setCompose(null); setDraft(""); } })}
                    className={smallPrimary} style={accentFill}>
                    {sending ? "Posting…" : "Comment"}
                  </button>
                  <button onClick={() => setCompose(null)} className={smallBtn}>Cancel</button>
                </div>
              </div>
            ) : (
              // The host takes comments only on lines the change touched or shows around them.
              <p className="mb-2 px-0.5 text-[11.5px] leading-relaxed text-text-muted">Click a line number in the diff to comment on that line.</p>
            )}
            {fileThreads.map(threadCard)}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
