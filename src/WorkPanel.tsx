// The uncommitted row's sidebar: stage, unstage, discard and commit, the way GitKraken's WIP node
// does — so a commit can be made from the graph without going to Source Control.
//
// It reads `git status` itself rather than taking the graph's list: staging moves a file between
// the two lists here, and the graph only needs to know that something changed, which it hears
// through GIT_CHANGED.
import { Fragment, useEffect, useState } from "react";
import { Plus, Minus, Undo2, X, FileSymlink, History, Sparkles, Loader2, ChevronRight, ChevronDown, List, ListTree, ArrowUpFromLine, RefreshCw, Check, GitCompare } from "lucide-react";
import {
  gitStatus, gitAiCommitMsg, gitFileBytes, fsRead, fsReadBytes, fsReveal, type GitStatusRow,
} from "../shim/bridge.js";
import { gitDiscard, gitStage, gitUnstage, gitCommit, gitCommitAmend, gitUndoCommit, gitHead, gitPush, gitPullRebase, gitTakeSide } from "./git";
import { FileIcon } from "../shim/ui.js";
import { useMessageVersion, useWriting, writeMessage } from "./aimessage";
import type { ConfirmState } from "../shim/ui.js";
import { ContextMenu, type MenuEntry } from "../shim/ui.js";
import type { IconTheme } from "../shim/ui.js";
import { useEditorSettings } from "../shim/ui.js";
import { statusColor, buildChangeTree, collectFiles, type TreeNodeOf } from "../shim/ui.js";
import { baseName, iconBtn, dangerBtn, toolBtn, field, heading, countChip, accentFill } from "./util";
import { decodeText } from "../shim/ui.js";

/** Fired on window with the repo root as detail after this panel changes the repo; the graph reloads. */
export const GIT_CHANGED = "deck-git-changed";

/**
 * The last action that can be taken back, per repo — GitKraken's one step of undo. Set by the
 * graph's actions and by a commit here; any other action replaces or clears it, since what it
 * would undo may no longer be where it was. Read by the graph's Undo button.
 */
export interface UndoEntry { label: string; run: () => Promise<unknown> }
/**
 * `at` is HEAD right after the action. A commit or checkout made anywhere else — a terminal,
 * Source Control — moves it without touching this store, and an undo run then would land past
 * that work; so the Undo button refuses when HEAD is no longer `at`.
 */
export const undoStore = new Map<string, UndoEntry & { at: string }>();

/**
 * One status row's diff: a staged row is the index against HEAD, an unstaged one the file on
 * disk against the index — what `git diff --cached` and `git diff` would show.
 */
export async function statusFileSides(root: string, row: GitStatusRow) {
  // As bytes, decoded by the file's own mark (see openDiff in Editor.tsx); this diff is read-only.
  const text = (b: Promise<Uint8Array>) => b.then((x) => decodeText(x)).catch(() => ({ text: "", utf8: true }));
  const [base, mod] = await Promise.all(row.staged
    ? [text(gitFileBytes(root, "HEAD", row.rel)), text(gitFileBytes(root, "", row.rel))]
    : [text(gitFileBytes(root, "", row.rel)), text(fsReadBytes(row.path))]);
  // `utf8`: both sides are UTF-8, so a change can be staged or reverted from the diff. Anything
  // else would be written back as UTF-8.
  return { base: base.text, mod: mod.text, utf8: base.utf8 && mod.utf8, title: `${baseName(row.rel)} (${row.staged ? "Staged" : "Working Tree"})` };
}

/** A status row's identity across the two lists: the same file can be in both. */
export const rowKey = (r: { staged: boolean; rel: string }) => (r.staged ? "s:" : "w:") + r.rel;

/**
 * The commit message being written and what is folded, per repo, kept across mounts: the panel
 * unmounts on every tab switch, and coming back to an empty message box lost what was typed.
 * Shared by the editor's panel and the graph pane's, which show the same repo's changes.
 */
const drafts = new Map<string, { summary: string; desc: string; folded: Set<string> }>();

export function WorkPanel({ root, polled, theme, treeView, onToggleTree, onOpenFile, onEditFile, onFileHistory, onClose, onConfirm, selected }: {
  root: string;
  /**
   * The editor's own git poll of this repo. A new value means the working tree moved, so the list
   * is read again: without it a file changed outside Deck (an agent writing it) was counted by the
   * Source Control badge but missing here until something Deck did reloaded the panel.
   */
  polled?: unknown;
  theme: IconTheme;
  /** The row whose diff is showing (its rowKey), highlighted. */
  selected?: string;
  /** Shared with the Commit panel's toggle, so both lists read the same way. */
  treeView: boolean;
  onToggleTree: () => void;
  /** Click a row: its diff. */
  onOpenFile: (row: GitStatusRow) => void;
  /** The row's Open File button: the file itself, to edit — Source Control's button. */
  onEditFile: (row: GitStatusRow) => void;
  /** The row's History button: the Git Graph filtered to this file. */
  onFileHistory?: (row: GitStatusRow) => void;
  onClose: () => void;
  onConfirm: (s: ConfirmState) => void;
}) {
  const settings = useEditorSettings();
  const [rows, setRows] = useState<GitStatusRow[]>([]);
  const kept = drafts.get(root);
  const [summary, setSummary] = useState(kept?.summary ?? "");
  const [desc, setDesc] = useState(kept?.desc ?? "");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState<"" | "commit">("");
  // The AI message is written outside the panel (aimessage.ts), so it survives a tab switch: it
  // lands in the draft, and the draft is read again here when it does.
  const writing = useWriting(root);
  const landed = useMessageVersion();
  const [commitMenu, setCommitMenu] = useState<{ x: number; y: number } | null>(null);
  /** A file's or folder's right-click menu. */
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  // Collapsed sections ("Unstaged", "Staged") and tree-view folders, keyed by list and path so the
  // two lists fold separately.
  const [folded, setFolded] = useState<Set<string>>(kept?.folded ?? new Set());
  const fold = (key: string) => setFolded((f) => { const n = new Set(f); if (!n.delete(key)) n.add(key); return n; });
  useEffect(() => { drafts.set(root, { summary, desc, folded }); }, [root, summary, desc, folded]);
  useEffect(() => { const d = drafts.get(root); if (d) { setSummary(d.summary); setDesc(d.desc); } }, [landed]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = () => void gitStatus(root).then(setRows).catch(() => setRows([]));
  useEffect(load, [root, polled]); // eslint-disable-line react-hooks/exhaustive-deps
  // Anything else that moves the repo — the graph's toolbar, a stash, a checkout — re-reads here.
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === root) load(); };
    window.addEventListener(GIT_CHANGED, on);
    return () => window.removeEventListener(GIT_CHANGED, on);
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (title: string, e: unknown) => onConfirm({
    title, confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {},
    body: <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px]">{String(e).replace(/^Error:\s*/, "")}</pre>,
  });
  /** Run a git write, then tell everyone — this panel included, through its own listener. */
  const run = async (fn: () => Promise<unknown>, failed: string) => {
    try { await fn(); } catch (e) { fail(failed, e); }
    window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root }));
  };

  // Conflicts ("!") apart, first: until they are resolved and staged nothing can be committed.
  const conflicts = rows.filter((r) => r.letter === "!");
  const unstaged = rows.filter((r) => !r.staged && r.letter !== "!");
  const staged = rows.filter((r) => r.staged);
  /**
   * Mark a conflict resolved: stage it as it is on disk. A file whose disk copy still holds a
   * block asks first, as a block resolved in the editor and not yet saved is still there.
   */
  const markResolved = async (r: GitStatusRow) => {
    const stage = () => void run(() => gitStage(root, [r.rel]), "Stage failed.");
    const text = await fsRead(r.path).catch(() => "");
    if (!/^<{7}(?: |\r?$)/m.test(text)) return stage();
    onConfirm({ title: `${baseName(r.rel)} still has conflict markers`, confirmLabel: "Mark resolved anyway", danger: false,
      body: "Its file on disk still holds a <<<<<<< block. Resolved it in the editor? Save it first: marking it resolved stages the file as it is on disk.",
      onConfirm: stage });
  };
  // Staged files are unstaged first, so they go back to the last commit rather than to the index,
  // and a file only ever added is deleted, as an untracked one is.
  const discard = (list: GitStatusRow[]) => onConfirm({
    title: list.length === 1 ? `Discard changes to ${baseName(list[0].rel)}?`
      : list === unstaged ? `Discard all ${list.length} unstaged changes?` : `Discard ${list.length} changes?`,
    body: list.some((r) => r.staged)
      ? "The staged and working-tree changes are lost; a file not in the last commit is deleted. This cannot be undone."
      : "The working-tree changes are lost; an untracked file is deleted. This cannot be undone.",
    confirmLabel: "Discard", danger: true,
    onConfirm: () => void run(async () => {
      const staged = list.filter((r) => r.staged).map((r) => r.rel);
      if (staged.length) await gitUnstage(root, staged);
      await gitDiscard(root, list.map((r) => r.rel));
    }, "Discard failed."),
  });

  /** A file's right-click menu (`f`), or a folder's (every file under it in `rs`, on one side). */
  const menuFor = (rs: GitStatusRow[], f: GitStatusRow | null): MenuEntry[] => {
    const onStaged = !!rs[0]?.staged, n = `${rs.length} file${rs.length === 1 ? "" : "s"}`;
    const deleted = f?.letter === "D";
    const copy = (text: string) => void navigator.clipboard.writeText(text).catch((e) => console.warn("[git] copy failed", e));
    // A conflict: no diff to open (the index holds both sides), and nothing to discard mid-merge.
    if (f?.letter === "!") return [
      { label: "Open File", icon: FileSymlink, onClick: () => onEditFile(f) },
      "sep",
      { label: "Accept All Current (ours)", onClick: () => void run(() => gitTakeSide(root, [f.rel], "ours"), "Could not take the current change.") },
      { label: "Accept All Incoming (theirs)", onClick: () => void run(() => gitTakeSide(root, [f.rel], "theirs"), "Could not take the incoming change.") },
      { label: "Mark as Resolved", icon: Check, onClick: () => void markResolved(f) },
      "sep",
      { label: "Copy Path", onClick: () => copy(f.path) },
      { label: "Copy Relative Path", onClick: () => copy(f.rel) },
    ];
    return [
      ...(f ? [
        { label: "Open Changes", icon: GitCompare, disabled: f.letter === "!", onClick: () => onOpenFile(f) },
        { label: "Open File", icon: FileSymlink, disabled: deleted, onClick: () => onEditFile(f) },
        ...(onFileHistory && f.letter !== "?" && f.letter !== "A" ? [{ label: "File History", icon: History, onClick: () => onFileHistory(f) }] : []),
        "sep",
      ] as MenuEntry[] : []),
      onStaged
        ? { label: f ? "Unstage Changes" : `Unstage ${n}`, icon: Minus, onClick: () => void run(() => gitUnstage(root, rs.map((r) => r.rel)), "Unstage failed.") }
        : { label: f ? "Stage Changes" : `Stage ${n}`, icon: Plus, onClick: () => void run(() => gitStage(root, rs.map((r) => r.rel)), "Stage failed.") },
      { label: f ? "Discard Changes" : `Discard Changes in ${n}`, icon: Undo2, danger: true, disabled: rs.some((r) => r.letter === "!"), onClick: () => discard(rs) },
      ...(f ? [
        "sep",
        { label: "Copy Path", onClick: () => copy(f.path) },
        { label: "Copy Relative Path", onClick: () => copy(f.rel) },
        { label: "Reveal in File Explorer", disabled: deleted, onClick: () => void fsReveal(f.path).catch((e) => fail("Reveal failed.", e)) },
      ] as MenuEntry[] : []),
    ];
  };
  const openMenu = (e: React.MouseEvent, rs: GitStatusRow[], f: GitStatusRow | null) => {
    e.preventDefault();
    setRowMenu({ x: e.clientX, y: e.clientY, items: menuFor(rs, f) });
  };

  const message = summary.trim() + (desc.trim() ? "\n\n" + desc.trim() : "");
  // git_commit stages everything when nothing is staged, as Source Control's Commit does.
  const canCommit = !busy && !writing && (amend || (summary.trim() !== "" && rows.length > 0));
  // `then`: Source Control's Commit & Push and Commit & Sync (pull --rebase, then push).
  const commit = async (then?: "push" | "sync") => {
    if (!canCommit) return;
    setBusy("commit");
    let ok = true;
    await run(async () => {
      try { await (amend ? gitCommitAmend(root, message) : gitCommit(root, message)); }
      catch (e) { ok = false; throw e; }
    }, amend ? "Amend failed." : "Commit failed.");
    if (ok) {
      // A commit undoes to its changes staged again; an amend has no simple way back.
      const at = amend ? null : await gitHead(root).catch(() => null);
      if (at) undoStore.set(root, { label: "commit", run: () => gitUndoCommit(root), at: at.hash });
      else undoStore.delete(root);
      setSummary(""); setDesc(""); setAmend(false);
      // The draft too: the panel may be gone by now (another tab), and would bring the message back.
      const d = drafts.get(root);
      if (d) drafts.set(root, { ...d, summary: "", desc: "" });
      if (then) {
        await run(async () => { if (then === "sync") await gitPullRebase(root); await gitPush(root); },
          then === "sync" ? "Sync failed." : "Push failed.");
        // Pushed: taking the commit back now would rewrite what others may already have.
        undoStore.delete(root);
      }
    }
    setBusy("");
  };
  const generate = () => writeMessage(root,
    () => gitAiCommitMsg(root, settings.aiCommitCommand, settings.aiCommitArgs, settings.aiCommitModel),
    (m) => {
      const [first, ...rest] = m.split("\n");
      drafts.set(root, { ...(drafts.get(root) ?? { folded: new Set<string>() }), summary: first, desc: rest.join("\n").trim() });
    });

  // Render functions, not components declared in here: a component defined inside another is a
  // new type on every render, so React rebuilt the whole list each time — and a click whose
  // mouse-down caused a render (making the pane active does) landed on a button already gone.
  //
  // `depth` is set in tree view, where the folder rows carry the path and the dir text would repeat it.
  const row = (r: GitStatusRow, depth?: number) => {
    const name = baseName(r.rel);
    const dir = depth === undefined ? r.rel.slice(0, -name.length).replace(/\/$/, "") : "";
    return (
      <div key={rowKey(r)} className={"group flex h-6 items-center gap-1.5 rounded-md pl-1.5 pr-1 text-[12.5px] transition-colors "
        + (selected === rowKey(r) ? "text-text-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary")}
        style={{ paddingLeft: depth !== undefined ? 6 + depth * 14 : undefined, background: selected === rowKey(r) ? "var(--accent-soft)" : undefined }}
        onContextMenu={(e) => openMenu(e, [r], r)}>
        {/* A conflict ("!") opens as the file: the index has no single copy of it to diff against. */}
        <button onClick={() => (r.letter === "!" ? onEditFile(r) : onOpenFile(r))} title={r.rel} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {depth !== undefined && <span className="w-3 shrink-0" /> /* align with folder chevrons */}
          <FileIcon icon={theme.file(name)} size={15} />
          {/* Both may shrink, the folder first: a long name used to keep its full width and run
              over the row's stage / discard buttons. */}
          <span className="min-w-0 truncate" style={{ color: statusColor(r.letter) }}>{name}</span>
          {dir && <span className="min-w-0 shrink-[4] truncate text-[11px] text-text-muted">{dir}</span>}
        </button>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {r.letter !== "D" && <button onClick={() => onEditFile(r)} title="Open File" className={iconBtn}><FileSymlink size={13} /></button>}
          {/* A new or untracked file has no history yet. */}
          {onFileHistory && r.letter !== "?" && r.letter !== "A" && (
            <button onClick={() => onFileHistory(r)} title="File history in the graph" className={iconBtn}><History size={13} /></button>
          )}
          {/* Git refuses to discard a conflict mid-merge; staging it marks it resolved. */}
          {!r.staged && r.letter !== "!" && <button onClick={() => discard([r])} title="Discard changes" className={dangerBtn}><Undo2 size={13} /></button>}
          {r.staged
            ? <button onClick={() => void run(() => gitUnstage(root, [r.rel]), "Unstage failed.")} title="Unstage" className={iconBtn}><Minus size={13} /></button>
            : r.letter === "!"
            ? <button onClick={() => void markResolved(r)} title="Mark as Resolved" className={iconBtn}><Plus size={13} /></button>
            : <button onClick={() => void run(() => gitStage(root, [r.rel]), "Stage failed.")} title="Stage" className={iconBtn}><Plus size={13} /></button>}
        </span>
        <span className="w-4 shrink-0 text-center text-[11px] font-semibold" style={{ color: statusColor(r.letter) }}>{r.letter}</span>
      </div>
    );
  };

  // `flat`: always a list (conflicts), as a folder row's Discard would reach them.
  const section = (title: string, list: GitStatusRow[], action: React.ReactNode, flat = false) => {
    const open = !folded.has(title);
    return (
      <div className="mb-1">
        {/* The section's actions show while its heading is hovered, as a row's do. */}
        <div className="group flex h-7 items-center gap-1 rounded-md px-1">
          <button onClick={() => fold(title)} title={open ? "Collapse" : "Expand"} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <ChevronRight size={12} className="shrink-0 text-text-muted transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />
            <span className={heading}>{title}</span>
          </button>
          <span className="hidden items-center gap-0.5 group-hover:flex">{list.length > 0 && action}</span>
          <span className={"ml-1 " + countChip}>{list.length}</span>
        </div>
        {open && (treeView && !flat
          ? buildChangeTree(list).map((n) => treeNode(n, 0, title))
          : list.map((r) => row(r)))}
      </div>
    );
  };
  const treeNode = (n: TreeNodeOf<GitStatusRow>, depth: number, at: string): React.ReactElement => {
    if (n.kind === "file") return row(n.row, depth);
    const key = `${at}/${n.name}`;
    const open = !folded.has(key);
    return (
      <Fragment key={key}>
        <div className="group flex h-6 items-center gap-1 rounded-md pr-1 text-[12.5px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
          style={{ paddingLeft: 6 + depth * 14 }} onContextMenu={(e) => openMenu(e, collectFiles(n), null)}>
          <button onClick={() => fold(key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <ChevronRight size={12} className="shrink-0 text-text-muted transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />
            <FileIcon icon={theme.folder(n.name, open)} size={15} />
            <span className="truncate">{n.name}</span>
          </button>
          {/* What a file row offers, for everything in the folder. */}
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            {at.startsWith("Unstaged") && <button onClick={() => discard(collectFiles(n))} title="Discard changes in folder" className={dangerBtn}><Undo2 size={13} /></button>}
            {at.startsWith("Staged")
              ? <button onClick={() => void run(() => gitUnstage(root, collectFiles(n).map((r) => r.rel)), "Unstage failed.")} title="Unstage folder" className={iconBtn}><Minus size={13} /></button>
              : <button onClick={() => void run(() => gitStage(root, collectFiles(n).map((r) => r.rel)), "Stage failed.")} title="Stage folder" className={iconBtn}><Plus size={13} /></button>}
          </span>
        </div>
        {open && n.children.map((c) => treeNode(c, depth + 1, key))}
      </Fragment>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 px-2.5 pb-1 pt-2">
        <span className="min-w-0 truncate text-[12.5px] font-medium text-text-primary">Uncommitted changes</span>
        <button onClick={onToggleTree} title={treeView ? "View as List" : "View as Tree"} className={toolBtn + " ml-auto"}>
          {treeView ? <List size={14} /> : <ListTree size={14} />}
        </button>
        <button onClick={onClose} title="Close" className={toolBtn}><X size={14} /></button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {rows.length === 0 && (
          <div className="flex items-start gap-2 px-2.5 py-2 text-[12px] leading-relaxed text-text-muted">
            <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
            <span>Nothing to commit. Every file matches the last commit.</span>
          </div>
        )}
        {conflicts.length > 0 && section("Merge Changes", conflicts, null, true)}
        {section("Unstaged", unstaged, <>
          <button onClick={() => discard(unstaged)} title="Discard all" className={dangerBtn}><Undo2 size={13} /></button>
          <button onClick={() => void run(() => gitStage(root, []), "Stage failed.")} title="Stage all" className={iconBtn}><Plus size={13} /></button>
        </>)}
        {section("Staged", staged,
          <button onClick={() => void run(() => gitUnstage(root, []), "Unstage failed.")} title="Unstage all" className={iconBtn}><Minus size={13} /></button>)}
      </div>

      {/* The commit box. Ctrl+Enter commits from either field. */}
      <div className="space-y-1.5 border-t border-subtle px-2.5 pb-2.5 pt-2"
        onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); void commit(); } }}>
        <div className="relative">
          {/* One line of text, wrapped onto as many rows as it needs (field-sizing grows the box
              to fit). Enter would only add a line break a summary cannot have; Ctrl+Enter still
              commits, from the box's keydown. */}
          <textarea value={summary} onChange={(e) => setSummary(e.target.value.replace(/\r?\n/g, " "))} placeholder="Summary" rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey) e.preventDefault(); }}
            style={{ height: "auto", fieldSizing: "content" } as React.CSSProperties}
            className={field + " block resize-none px-2.5 py-1.5 pr-8 leading-5"} />
          {/* Inside the box, at its end, as a field's own controls are. */}
          <button onClick={generate} disabled={!!busy || writing} title="Generate a message with AI"
            className="absolute right-1 top-1 grid size-6 place-items-center rounded-md text-text-muted transition-colors hover:bg-white/5 hover:text-[var(--accent)] disabled:opacity-40">
            {writing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          </button>
        </div>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" rows={7}
          // An explicit height of auto, so `rows` sets it (a fixed field height kept it from applying).
          style={{ height: "auto" }}
          className={field + " block resize-y px-2.5 py-1.5 leading-5"} />
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-secondary">
          <input type="checkbox" className="accent-[var(--accent)]" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          Amend the previous commit
        </label>
        {/* A split button: commit, or the arrow for commit-then-push / -sync. */}
        <div className="flex h-8 overflow-hidden rounded-lg text-[12.5px] font-medium text-white" style={accentFill}>
          <button onClick={() => void commit()} disabled={!canCommit}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 hover:brightness-110 disabled:opacity-50">
            {busy === "commit" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            <span className="truncate">
              {amend ? "Amend previous commit"
                : staged.length ? `Commit ${staged.length} staged file${staged.length === 1 ? "" : "s"}`
                : `Stage all and commit ${rows.length} file${rows.length === 1 ? "" : "s"}`}
            </span>
          </button>
          <button disabled={!canCommit} title="Commit options"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCommitMenu({ x: r.right, y: r.top - 4 }); }}
            className="flex items-center border-l border-white/20 px-2 hover:brightness-110 disabled:opacity-50"><ChevronDown size={14} /></button>
        </div>
        {commitMenu && (
          <ContextMenu x={commitMenu.x} y={commitMenu.y} alignRight onClose={() => setCommitMenu(null)} items={[
            { label: amend ? "Amend & Push" : "Commit & Push", icon: ArrowUpFromLine, onClick: () => void commit("push") },
            { label: amend ? "Amend & Sync" : "Commit & Sync", subLabel: "Pull with rebase, then push", icon: RefreshCw, onClick: () => void commit("sync") },
          ]} />
        )}
        {rowMenu && <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowMenu.items} onClose={() => setRowMenu(null)} />}
      </div>
    </div>
  );
}
