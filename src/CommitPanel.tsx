// The Commit panel and file history: two views over git history that share one flow —
// pick a commit, see its files, open any of them as a diff.
//
// Split out of Editor.tsx: they own no editor state, taking a commit and callbacks.
import { useEffect, useState } from "react";
import { WORKTREE } from "./GitGraph";
import { ChevronRight, List, ListTree, X, History, FileSymlink } from "lucide-react";
import type { CommitFile, GraphCommit } from "../shim/bridge.js";
import { FileIcon } from "../shim/ui.js";
import type { IconTheme } from "../shim/ui.js";
import { buildChangeTree, statusColor, type TreeNodeOf } from "../shim/ui.js";
import { baseName } from "./util";

/**
 * One row of a commit's file tree — the read-only twin of ChangeRow.
 *
 * Same 22px height, indent step, icons and status-letter column as Source Control, so the two
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
      <div className={"group flex h-[22px] items-center gap-1.5 rounded px-1 text-text-secondary hover:bg-elev hover:text-text-primary "
        + (activeRel === node.row.rel ? "bg-elev" : "")}
        style={{ paddingLeft: 6 + depth * 14 }}>
        {/* The name gets every pixel the actions and the letter do not, so it can be read. The line
            counts are a detail, shown on hover over the END of the name: absolutely placed, so
            nothing in the row moves, and pointer-events-none, so a click there still opens the
            diff and can never land on them instead of on an action. */}
        <div className="relative flex min-w-0 flex-1">
          <button onClick={() => onOpen(node.row)} title={node.row.rel}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <span className="w-3 shrink-0" /> {/* align with folder chevrons */}
            <FileIcon icon={theme.file(node.name)} size={16} />
            <span className="truncate" style={{ color: statusColor(node.row.letter) }}>{node.name}</span>
          </button>
          {(node.row.adds > 0 || node.row.dels > 0) && (
            <span className="pointer-events-none absolute inset-y-0 right-0 hidden items-center gap-1 bg-elev pl-1.5 text-[10px] tabular-nums group-hover:flex">
              {node.row.adds > 0 && <span style={{ color: "#81b88b" }}>+{node.row.adds}</span>}
              {node.row.dels > 0 && <span style={{ color: "#c74e39" }}>-{node.row.dels}</span>}
            </span>
          )}
        </div>
        {/* The actions are always on screen, so they can be found without hovering; muted until
            the row is hovered, so a list of them does not shout. They never move. */}
        <span className="flex shrink-0 items-center opacity-50 transition-opacity group-hover:opacity-100">
          {/* Not for a file this commit deleted, which has nothing at that path to open. Its slot
              stays, so the History buttons line up down the list. */}
          {onEdit && (node.row.letter !== "D"
            ? <button onClick={() => onEdit(node.row)} title="Open File" className="vscode-toggle"><FileSymlink size={12} /></button>
            : <span className="vscode-toggle invisible"><FileSymlink size={12} /></span>)}
          {onHistory && (
            <button onClick={() => onHistory(node.row)} title="File history in the graph" className="vscode-toggle"><History size={12} /></button>
          )}
        </span>
        <span className="w-4 shrink-0 text-center text-[11px] font-bold" style={{ color: statusColor(node.row.letter) }}>{node.row.letter}</span>
      </div>
    );
  }
  return (
    <>
      <div className="group flex h-[22px] items-center gap-1 rounded px-1 text-sm text-text-secondary hover:bg-elev hover:text-text-primary"
        style={{ paddingLeft: 6 + depth * 14 }}>
        <button onClick={() => setCollapsed((c) => !c)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <ChevronRight size={12} className="shrink-0 text-text-muted transition-transform" style={{ transform: collapsed ? "none" : "rotate(90deg)" }} />
          <FileIcon icon={theme.folder(node.name, !collapsed)} size={16} />
          <span className="truncate text-[13px]">{node.name}</span>
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
  const msg = view.meta && !work ? view.meta.subject + (view.meta.body ? "\n\n" + view.meta.body : "") : "";
  const longMsg = msg.split("\n").length > 4 || msg.length > 280;
  const adds = view.files.reduce((n, f) => n + f.adds, 0);
  const dels = view.files.reduce((n, f) => n + f.dels, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Same header shape as Source Control's. */}
      <div className="flex items-center gap-0.5 border-b border-subtle px-2 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Commit</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={onToggleTree} title={treeView ? "View as List" : "View as Tree"} className="vscode-toggle">
            {treeView ? <List size={14} /> : <ListTree size={14} />}
          </button>
          <button onClick={onClose} title="Close" className="vscode-toggle"><X size={14} /></button>
        </div>
      </div>

      <div className="border-b border-subtle px-3 py-2">
        {/* Two lines, so nothing wraps at sidebar width: who and when, then the commit and its
            parent. */}
        {work ? <div className="text-[11px] text-text-muted">Working tree, against HEAD</div> : <>
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="min-w-0 flex-1 truncate text-text-secondary" title={view.meta?.email}>{view.meta?.author}</span>
            <span className="shrink-0">{view.meta?.date}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-text-muted">
            <span title={view.hash}>{view.hash.slice(0, 7)}</span>
            {view.meta?.parents[0] && <span className="truncate" title={view.meta.parents.join(", ")}>
              {view.meta.parents.length > 1 ? "merge of " : "parent "}{view.meta.parents.map((p) => p.slice(0, 7)).join(" + ")}
            </span>}
          </div>
        </>}
        {work && <div className="mt-1 text-[12px] text-text-primary">Uncommitted changes</div>}
        {msg && (
          // Expanded, it still stops at a third of the window and scrolls inside.
          <pre className={"scroll-thin mt-1 whitespace-pre-wrap break-words font-sans text-[12px] text-text-primary "
            + (fullMsg ? "max-h-[33vh] overflow-y-auto" : "line-clamp-4")}>{msg}</pre>
        )}
        {longMsg && (
          <button onClick={() => setFullMsg((f) => !f)} className="mt-0.5 text-[11px] text-[var(--accent)] hover:underline">
            {fullMsg ? "Show less" : "Show more"}
          </button>
        )}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
          <span>{view.files.length} file{view.files.length === 1 ? "" : "s"}</span>
          <span style={{ color: "#81b88b" }}>+{adds}</span>
          <span style={{ color: "#c74e39" }}>-{dels}</span>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {busy && <p className="px-2 py-3 text-xs text-text-muted">Loading…</p>}
        {!busy && view.files.length === 0 && <p className="px-2 py-3 text-xs text-text-muted">No files.</p>}
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


