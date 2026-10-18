// The Commit panel and file history: two views over git history that share one flow —
// pick a commit, see its files, open any of them as a diff.
//
// Split out of Editor.tsx: they own no editor state, taking a commit and callbacks.
import { useEffect, useState } from "react";
import { WORKTREE, avatarOf } from "./GitGraph";
import { ChevronRight, List, ListTree, X, History, FileSymlink, Loader2 } from "lucide-react";
import type { CommitFile, GraphCommit } from "../shim/bridge.js";
import { FileIcon } from "../shim/ui.js";
import type { IconTheme } from "../shim/ui.js";
import { buildChangeTree, statusColor, type TreeNodeOf } from "../shim/ui.js";
import { baseName, iconBtn, toolBtn } from "./util";

/**
 * One row of a commit's file tree — the read-only twin of ChangeRow.
 *
 * Same 24px height, indent step, icons and status-letter column as Source Control, so the two
 * panels read as one thing. No staging actions: a commit is history, there is nothing to stage,
 * discard or unstage. Clicking opens that file's diff against the commit's parent.
 */
export function CommitRow({ node, depth, theme, onOpen, onEdit, activeRel, onHistory }: {
  node: TreeNodeOf<CommitFile>; depth: number; theme: IconTheme; onOpen: (f: CommitFile) => void;
  /** The row's Open File button: the file as it is in the working tree now, to edit — the same
   *  button the uncommitted rows have. */
  onEdit?: (f: CommitFile) => void;
  /** The file whose diff is showing, or whose history the graph is showing, highlighted. */
  activeRel?: string;
  /** The row's History button: the Git Graph filtered to this file. */
  onHistory?: (f: CommitFile) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (node.kind === "file") {
    return (
      <div className={"group flex h-6 items-center gap-1.5 rounded-md pr-1 text-[12.5px] transition-colors "
        + (activeRel === node.row.rel ? "text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary")}
        style={{ paddingLeft: 6 + depth * 14, background: activeRel === node.row.rel ? "var(--accent-soft)" : undefined }}>
        {/* The name gets every pixel the actions and the letter do not, so it can be read. The line
            counts are a detail, shown on hover after the name, inside the button: a click on them
            still opens the diff and can never land on an action instead. */}
        <button onClick={() => onOpen(node.row)} title={node.row.rel}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="w-3 shrink-0" /> {/* align with folder chevrons */}
          <FileIcon icon={theme.file(node.name)} size={15} />
          <span className="truncate" style={{ color: statusColor(node.row.letter) }}>{node.name}</span>
          {(node.row.adds > 0 || node.row.dels > 0) && (
            <span className="hidden shrink-0 items-center gap-1 text-[10.5px] tabular-nums group-hover:flex">
              {node.row.adds > 0 && <span style={{ color: "var(--git-added)" }}>+{node.row.adds}</span>}
              {node.row.dels > 0 && <span style={{ color: "var(--git-deleted)" }}>-{node.row.dels}</span>}
            </span>
          )}
        </button>
        {/* The actions show while the row is hovered, as Source Control's do. Faded in rather than
            added, so the name never changes width under the pointer. */}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {/* Not for a file this commit deleted, which has nothing at that path to open. Its slot
              stays, so the History buttons line up down the list. */}
          {onEdit && (node.row.letter !== "D"
            ? <button onClick={() => onEdit(node.row)} title="Open File" className={iconBtn}><FileSymlink size={13} /></button>
            : <span className={iconBtn + " invisible"}><FileSymlink size={13} /></span>)}
          {onHistory && (
            <button onClick={() => onHistory(node.row)} title="File history in the graph" className={iconBtn}><History size={13} /></button>
          )}
        </span>
        <span className="w-4 shrink-0 text-center text-[11px] font-semibold" style={{ color: statusColor(node.row.letter) }}>{node.row.letter}</span>
      </div>
    );
  }
  return (
    <>
      <div className="group flex h-6 items-center gap-1 rounded-md pr-1 text-[12.5px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
        style={{ paddingLeft: 6 + depth * 14 }}>
        <button onClick={() => setCollapsed((c) => !c)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRight size={12} className="shrink-0 text-text-muted transition-transform" style={{ transform: collapsed ? "none" : "rotate(90deg)" }} />
          <FileIcon icon={theme.folder(node.name, !collapsed)} size={15} />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {!collapsed && node.children.map((c, i) => (
        <CommitRow key={i} node={c} depth={depth + 1} theme={theme} onOpen={onOpen} onEdit={onEdit} activeRel={activeRel} onHistory={onHistory} />
      ))}
    </>
  );
}

/**
 * The Commit panel: one commit's files, with prev/next to walk history.
 *
 * Reached from the status bar's blame indicator — "what else changed in the commit that touched
 * this line". Shares Source Control's header, row styling and tree/list preference so it is the
 * same panel with a different source of rows.
 */
export function CommitPanel({ view, busy, treeView, onToggleTree, theme, onOpenFile, onEditFile, onClose, onFileHistory, activeRel }: {
  view: { hash: string; files: CommitFile[]; log: GraphCommit[]; meta: GraphCommit | null };
  busy: boolean;
  treeView: boolean;
  onToggleTree: () => void;
  theme: IconTheme;
  onOpenFile: (f: CommitFile) => void;
  /** A row's Open File button: the file in the working tree, to edit. */
  onEditFile?: (f: CommitFile) => void;
  onClose: () => void;
  onFileHistory?: (f: CommitFile) => void;
  /** The file the graph is showing the history of, highlighted in the list. */
  activeRel?: string;
}) {
  // The message, collapsed to a few lines: a long body would otherwise push the file list off
  // the panel. Collapsed again for each commit stepped to.
  const [fullMsg, setFullMsg] = useState(false);
  useEffect(() => setFullMsg(false), [view.hash]);
  const work = view.hash === WORKTREE;
  // The body without its trailers (Co-Authored-By: …), which are shown apart: the last paragraph,
  // when every line of it is a "Key: value".
  const paras = (!work && view.meta?.body ? view.meta.body.trim() : "").split(/\n\s*\n/);
  const last = paras[paras.length - 1] ?? "";
  const isTrailers = !!last && last.split("\n").every((l) => /^[A-Za-z][\w-]*: \S/.test(l));
  const trailers = isTrailers ? last.split("\n") : [];
  const body = (isTrailers ? paras.slice(0, -1) : paras).join("\n\n").trim();
  const longMsg = body.split("\n").length > 4 || body.length > 280 || (trailers.length > 0 && !!body);
  const avatar = view.meta && !work ? avatarOf(view.meta.author, view.meta.email) : null;
  const adds = view.files.reduce((n, f) => n + f.adds, 0);
  const dels = view.files.reduce((n, f) => n + f.dels, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* What the commit says, then who and which: the subject is the panel's title, the way the
          graph row reads, and the panel's actions sit beside it. */}
      <div className="flex shrink-0 items-start gap-1.5 px-3 pb-2 pt-2.5">
        <div className="min-w-0 flex-1">
          <h2 className={"break-words text-[13px] font-semibold leading-5 text-text-primary " + (fullMsg ? "" : "line-clamp-3")}>
            {work ? "Uncommitted changes" : view.meta?.subject ?? view.hash.slice(0, 7)}
          </h2>
        </div>
        <div className="-mr-1 -mt-0.5 flex shrink-0 items-center gap-0.5">
          <button onClick={onToggleTree} title={treeView ? "View as List" : "View as Tree"} className={toolBtn}>
            {treeView ? <List size={14} /> : <ListTree size={14} />}
          </button>
          <button onClick={onClose} title="Close" className={toolBtn}><X size={14} /></button>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 px-3 pb-3">
        {work ? <div className="text-[11.5px] text-text-muted">The working tree, against HEAD.</div> : view.meta && <>
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: avatar!.color }} aria-hidden>{avatar!.initials}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary" title={view.meta.email}>{view.meta.author}</span>
            <span className="shrink-0 text-[11px] text-text-muted">{view.meta.date}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            <span className="rounded-md px-1.5 py-0.5 text-text-secondary" style={{ background: "var(--bg-elev)" }} title={view.hash}>{view.hash.slice(0, 7)}</span>
            {view.meta.parents[0] && (
              <span className="flex min-w-0 items-center gap-1 text-text-muted" title={view.meta.parents.join(", ")}>
                <span className="font-sans">{view.meta.parents.length > 1 ? "merge of" : "parent"}</span>
                {view.meta.parents.map((p) => (
                  <span key={p} className="rounded-md px-1.5 py-0.5" style={{ background: "var(--bg-elev)" }}>{p.slice(0, 7)}</span>
                ))}
              </span>
            )}
          </div>
        </>}
        {(body || trailers.length > 0) && (
          // Expanded, it still stops at a third of the window and scrolls inside.
          <div className={"scroll-thin flex flex-col gap-2 " + (fullMsg ? "max-h-[33vh] overflow-y-auto" : "")}>
            {body && (
              <pre className={"whitespace-pre-wrap break-words font-sans text-[12px] leading-5 text-text-secondary " + (fullMsg ? "" : "line-clamp-4")}>{body}</pre>
            )}
            {/* Trailers (Co-Authored-By, Signed-off-by) are about the commit, not what it says: set
                apart, smaller, one per line. */}
            {trailers.length > 0 && (fullMsg || !body) && (
              <div className="flex flex-col gap-0.5 border-l-2 border-subtle pl-2 text-[11px] text-text-muted">
                {trailers.map((t, i) => <span key={i} className="break-words">{t}</span>)}
              </div>
            )}
          </div>
        )}
        {longMsg && (
          <button onClick={() => setFullMsg((f) => !f)} className="-mt-1 self-start text-[11px] text-[var(--accent)] hover:underline">
            {fullMsg ? "Show less" : "Show more"}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-subtle px-3 pb-1 pt-2.5">
        <span className="text-[12px] font-medium text-text-secondary">Files</span>
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] tabular-nums text-text-secondary" style={{ background: "var(--bg-elev)" }}>{view.files.length}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] tabular-nums">
          <span className="rounded-full px-1.5 py-px" style={{ color: "var(--git-added)", background: "color-mix(in srgb, var(--git-added) 14%, transparent)" }}>+{adds}</span>
          <span className="rounded-full px-1.5 py-px" style={{ color: "var(--git-deleted)", background: "color-mix(in srgb, var(--git-deleted) 14%, transparent)" }}>-{dels}</span>
        </span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {busy && <p className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-text-muted"><Loader2 size={13} className="animate-spin" /> Reading the commit's files…</p>}
        {!busy && view.files.length === 0 && <p className="px-2.5 py-2 text-[12px] leading-relaxed text-text-muted">No files changed in this commit.</p>}
        {!busy && (treeView
          ? buildChangeTree(view.files).map((n, idx) => (
              <CommitRow key={idx} node={n} depth={0} theme={theme} onOpen={onOpenFile} onEdit={onEditFile} onHistory={onFileHistory} activeRel={activeRel} />
            ))
          : view.files.map((f) => (
              <CommitRow key={f.rel} node={{ kind: "file", row: f, name: baseName(f.rel) }} depth={0} theme={theme} onOpen={onOpenFile} onEdit={onEditFile} onHistory={onFileHistory} activeRel={activeRel} />
            )))}
      </div>
    </div>
  );
}


