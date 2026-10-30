// Git Graph as a pane: the graph, the commit it has open in a sidebar, and a file's diff in place
// of the graph until you go back. No tab bar — a pane is short of room, and one diff at a time
// is what the sidebar's file list is for.
//
// The editor's graph tab hands a clicked file to the editor around it. A pane has no editor
// around it, and switching to the workspace's editor took the graph off screen while you were
// still reading it — so the pane carries the two pieces of the editor it needs: the Commit panel
// and a read-only diff per file.
import { useEffect, useState, useSyncExternalStore } from "react";
import { getPending, subscribePending, takePending } from "./pending";
import { ArrowLeft, FolderGit2, X } from "lucide-react";
import { GitGraph, commitFileSides, WORKTREE } from "./GitGraph";
import { WorkPanel, statusFileSides, rowKey } from "./WorkPanel";
import { PrList, PrView } from "./PrReview";
import { CommitPanel } from "./CommitPanel";
import { MonacoDiff, applyLineChanges, type HunkAction } from "../shim/ui.js";
import { fsWrite } from "../shim/bridge.js";
import { gitSetIndexContent } from "./git";
import { GIT_CHANGED } from "./WorkPanel";
import { MediaDiff, mediaKind } from "../shim/ui.js";
import { ConflictView } from "./ConflictView";
import { baseName, toolBtn } from "./util";
import { RepoSelect, RepoTabs, useRepoList, useRepoTabs } from "./RepoTabs";
import { FileIcon } from "../shim/ui.js";
import { ConfirmDialog, type ConfirmState } from "../shim/ui.js";
import { useResize } from "../shim/ui.js";
import { useEditorSettings } from "../shim/ui.js";
import { themeById, useIconThemesVersion } from "../shim/ui.js";
import { gitCommitFiles, gitLogGraph, gitRepos, gitFileBytes, type CommitFile, type GraphCommit, type GitStatusRow } from "../shim/bridge.js";

/** `media`: an image, video, audio file or font, shown through the media viewer, not as text. */
interface Diff {
  id: string; title: string; path: string; base: string; mod: string;
  /** An uncommitted file's diff, which can stage, unstage and revert one change at a time. */
  row?: GitStatusRow;
  v?: number;
  media?: { file: string; old: Uint8Array; nu?: Uint8Array; gone: boolean; labels: [string, string] };
  /** A conflicted file ("!"), resolved in ConflictView rather than shown as a diff. */
  conflict?: GitStatusRow;
}
interface CommitView { hash: string; files: CommitFile[]; log: GraphCommit[]; meta: GraphCommit | null }

// Per pane (per folder in a Deck too old to say which pane), kept across mounts: a pane unmounts on every tab or workspace switch, and coming
// back to find the diffs you had open gone is losing your place. View state, so not on disk.
const kept = new Map<string, { diff: Diff | null; commit: CommitView | null; repo: string; file: string | null }>();

/** The way back from a diff or a pull request to the graph: a labelled toolbar button. */
const backBtn = "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary";

export default function GraphPane({ cwd, paneId }: { cwd: string; paneId?: string }) {
  // Two Git panes in one workspace share a folder, so each keeps its place by its pane.
  const place = paneId ?? cwd;
  const k = kept.get(place);
  const [diff, setDiff] = useState<Diff | null>(k?.diff ?? null);
  const [commit, setCommit] = useState<CommitView | null>(k?.commit ?? null);
  // The pull-request list in the side panel (in place of the commit), and the one being reviewed
  // in the main area (in place of the graph).
  const [prsOpen, setPrsOpen] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [pr, setPr] = useState<number | null>(null);
  // One file's history: the graph filtered to it (repo-relative path), or null for the whole graph.
  const [file, setFile] = useState<string | null>(k?.file ?? null);
  const showFile = (rel: string) => { setFile(rel); setDiff(null); setPr(null); };
  // The repo shown. The workspace folder is often not one: it may sit inside a repo (git's paths
  // are relative to that repo's top, not to the folder) or hold several side by side. So the
  // graph works on a repo's top level, and a folder with more than one gets a picker.
  const [repos, setRepos] = useState<string[] | null>(null);
  const [repo, setRepo] = useState(k?.repo ?? "");
  useEffect(() => {
    void gitRepos(cwd)
      .then((r) => { setRepos(r); setRepo((cur) => (r.includes(cur) ? cur : r[0] ?? "")); })
      .catch(() => setRepos([]));
  }, [cwd]);
  const pickRepo = (r: string) => { setRepo(r); setCommit(null); setDiff(null); setPr(null); setFile(null); };
  const repoTabs = useRepoTabs();
  // The repos in the order you dragged the tabs into, less the tabs you closed, for the tabs; the
  // dropdown (which lists the closed ones too, having no + to bring them back). Closing the open
  // one opens its neighbour.
  const list = useRepoList(cwd, repos ?? []);
  const hideRepo = (r: string) => {
    const at = list.shown.indexOf(r);
    list.hide(r);
    if (r === repo) pickRepo(list.shown[at + 1] ?? list.shown[at - 1] ?? r);
  };
  const [busy, setBusy] = useState(false);
  const [treeView, setTreeView] = useState(true);
  // The graph asks before a reset or a branch delete, and refuses the action with no one to ask
  // through — in the editor that is the editor's dialog, here it is this one.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [sideW, sideDrag] = useResize({ initial: 300, min: 160, max: 520, direction: "horizontal", invert: true });
  useEffect(() => { kept.set(place, { diff, commit, repo, file }); }, [place, diff, commit, repo, file]);
  // A commit Deck asked for (the Editor's blame hash): open its repo, unfiltered, with the commit
  // expanded in the graph and its files in the side panel.
  const [focusHash, setFocusHash] = useState<string | undefined>(undefined);
  const request = useSyncExternalStore(subscribePending, getPending);
  useEffect(() => {
    if (!request || repos === null) return;
    const want = request.root.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    const match = repos.find((r) => r.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() === want);
    // A commit of a repo this workspace does not hold is left for a pane that does.
    if (want && !match) return;
    takePending();
    if (match && match !== repo) setRepo(match);
    setFile(null); setDiff(null); setPr(null); setPrsOpen(false);
    setFocusHash(request.hash);
    void showCommitIn(match ?? repo, request.hash);
  }, [request, repos]);

  const settings = useEditorSettings();
  useIconThemesVersion();
  const theme = themeById(settings.iconTheme);

  // The log is fetched once and reused while stepping, as the editor's Commit panel does.
  // `preset` is the graph's uncommitted row, which git has no commit to look up for.
  const showCommit = (hash: string, log?: GraphCommit[], preset?: { files: CommitFile[]; meta: GraphCommit }) =>
    showCommitIn(repo, hash, log, preset);
  // The repo is passed rather than read, so a request can open a commit in the repo it is
  // switching to before that state has landed.
  async function showCommitIn(inRepo: string, hash: string, log?: GraphCommit[], preset?: { files: CommitFile[]; meta: GraphCommit }) {
    if (preset) { setCommit({ hash, files: preset.files, log: [], meta: preset.meta }); return; }
    setBusy(true);
    const [files, theLog] = await Promise.all([
      gitCommitFiles(inRepo, hash).catch((e) => { console.warn("[git] commit files load failed", e); return [] as CommitFile[]; }),
      log ? Promise.resolve(log) : gitLogGraph(inRepo, 0).catch((e) => { console.warn("[git] log load failed", e); return [] as GraphCommit[]; }),
    ]);
    setCommit({ hash, files, log: theLog, meta: theLog.find((c) => c.hash === hash) ?? null });
    setBusy(false);
  };

  // A file's diff takes the graph's place; the sidebar stays, so the next file is one click away.
  const openDiff = async (hash: string, parent: string | undefined, f: CommitFile) => {
    if (mediaKind(f.rel) && hash !== WORKTREE) {
      const [nu, old] = await Promise.all([
        gitFileBytes(repo, hash, f.rel).catch(() => new Uint8Array()),
        parent ? gitFileBytes(repo, parent, f.old ?? f.rel).catch(() => new Uint8Array()) : Promise.resolve(new Uint8Array()),
      ]);
      setDiff({ id: `${hash}:${f.rel}`, path: `${hash}:${f.rel}`, base: "", mod: "", title: `${baseName(f.rel)} (${hash.slice(0, 7)})`,
        media: { file: f.rel, old, nu, gone: false, labels: [parent ? parent.replace(/\^$/, "").slice(0, 7) : "Before", hash.slice(0, 7)] } });
      return;
    }
    const { mod, base, title } = await commitFileSides(repo, hash, parent, f);
    setDiff({ id: `${hash}:${f.rel}`, path: `${hash}:${f.rel}`, base, mod, title });
  };
  // An uncommitted file: staged and unstaged are separate diffs.
  const openStatusDiff = async (r: GitStatusRow) => {
    const key = `${WORKTREE}:${rowKey(r)}`;
    if (r.letter === "!") { setDiff({ id: key, path: key, base: "", mod: "", title: `${baseName(r.rel)} (Conflicts)`, conflict: r }); return; }
    if (mediaKind(r.rel)) {
      // Staged: HEAD against the index. Unstaged: the index against the file on disk.
      const [old, nu] = await Promise.all([
        gitFileBytes(repo, r.staged ? "HEAD" : "", r.rel).catch(() => new Uint8Array()),
        r.staged ? gitFileBytes(repo, "", r.rel).catch(() => new Uint8Array()) : Promise.resolve(undefined),
      ]);
      setDiff({ id: key, path: key, base: "", mod: "", title: `${baseName(r.rel)} (${r.staged ? "Staged" : "Working Tree"})`,
        media: { file: r.path, old, nu, gone: r.letter === "D", labels: r.staged ? ["HEAD", "Staged"] : ["Staged", "Working Tree"] } });
      return;
    }
    const { mod, base, title, utf8 } = await statusFileSides(repo, r);
    // `v`: read again after a change is staged or reverted, so the diff is rebuilt with the new sides.
    setDiff({ id: key, path: key, base, mod, title, row: utf8 ? r : undefined, v: Date.now() });
  };

  /**
   * One change at a time, from the diff's gutter. A working-tree diff is the index against the
   * file: stage puts one change into the index, revert takes it out of the file. A staged diff is
   * HEAD against the index: unstage takes one change back out of the index. Each writes the whole
   * new text, made by applying just that change (applyLineChanges), and the diff is read again.
   */
  const hunkAction = (r: GitStatusRow): HunkAction => {
    const done = async () => {
      window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: repo }));
      await openStatusDiff(r);
    };
    const fail = (what: string) => (e: unknown) => {
      console.warn(`[git] ${what} failed`, e);
      setConfirm({ title: `${what} failed`, confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {}, body: String(e).replace(/^Error:\s*/, "") });
    };
    // A change the other way round: the left side's lines laid over the right side's.
    const flip = (c: Parameters<HunkAction["run"]>[0]) => ({
      originalStartLineNumber: c.modifiedStartLineNumber, originalEndLineNumber: c.modifiedEndLineNumber,
      modifiedStartLineNumber: c.originalStartLineNumber, modifiedEndLineNumber: c.originalEndLineNumber, charChanges: undefined,
    });
    if (r.staged) return {
      label: "−", unstage: true,
      run: (c, m) => void gitSetIndexContent(repo, r.rel, applyLineChanges(m.modified, m.original, [flip(c)])).then(done, fail("Unstaging the change")),
    };
    return {
      label: "+", unstage: false,
      run: (c, m) => void gitSetIndexContent(repo, r.rel, applyLineChanges(m.original, m.modified, [c])).then(done, fail("Staging the change")),
      revert: (c, m) => setConfirm({
        title: "Revert this change?", confirmLabel: "Revert", danger: true,
        body: "These lines go back to their staged text, in the file on disk. This cannot be undone here.",
        onConfirm: () => void fsWrite(r.path, applyLineChanges(m.modified, m.original, [flip(c)])).then(done, fail("Reverting the change")),
      }),
    };
  };

  return (
    // Esc leaves a diff or a pull request from anywhere in the pane — the side panel included,
    // where the click that opened it left the focus. A field that used Esc itself (search) has
    // already handled it.
    <div className="flex min-h-0 min-w-0 flex-1" onKeyDown={(e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (diff) { e.preventDefault(); setDiff(null); } else if (pr != null) { e.preventDefault(); setPr(null); }
    }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Several repos under this folder, as tabs: above the graph, while it shows. */}
        {repoTabs && repos && repos.length > 1 && !diff && pr == null && <RepoTabs repos={list.shown} hidden={list.hidden} repo={repo} onPick={pickRepo} onReorder={list.reorder} onHide={hideRepo} onShow={list.show} />}
        {pr != null && !diff && (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-subtle px-1.5 text-[12.5px]">
            <button onClick={() => setPr(null)} title="Back to the graph (Esc)" className={backBtn}>
              <ArrowLeft size={13} /> Graph
            </button>
            <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{prTitle || `#${pr}`}</span>
            <button onClick={() => setPr(null)} title="Close" className={toolBtn}><X size={14} /></button>
          </div>
        )}
        {diff && (
          // Esc goes back too, from anywhere in the diff.
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-subtle px-1.5 text-[12.5px]">
            <button onClick={() => setDiff(null)} title="Back to the graph (Esc)" className={backBtn}>
              <ArrowLeft size={13} /> Graph
            </button>
            <FileIcon icon={theme.file(baseName(diff.path))} size={15} />
            <span className="min-w-0 flex-1 truncate text-text-primary" title={diff.path}>{diff.title}</span>
            <button onClick={() => setDiff(null)} title="Close" className={toolBtn}><X size={14} /></button>
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          {/* Hidden rather than unmounted while a diff is showing, so going back to the graph
              keeps its scroll position. */}
          <div className={diff || pr != null ? "hidden" : "h-full"}>
            {repos === null ? null
              : !repo ? (
                <div className="flex h-full items-center justify-center px-6">
                  <div className="flex max-w-sm items-start gap-2.5 rounded-lg border border-subtle bg-elev px-3 py-3 text-[12px] leading-relaxed text-text-muted">
                    <FolderGit2 size={16} className="mt-0.5 shrink-0" />
                    <span>No git repository in this folder. Open the workspace on a folder that holds one, or run <span className="font-mono text-text-secondary">git init</span> in a terminal here, to see its history.</span>
                  </div>
                </div>
              )
              // Keyed: the graph reads its state once on mount, so a new repo needs a new graph.
              : <GitGraph key={`${repo}:${file ?? ""}`} root={repo} onConfirm={setConfirm}
                  rel={file ?? undefined} onClearFile={() => setFile(null)} focusHash={focusHash}
                  onOpenCommit={(c, files, log) => { setPrsOpen(false); void showCommit(c.hash, log, files && { files, meta: c }); }}
                  onShowPrs={() => setPrsOpen(true)}
                  // Several repos under this folder, as a dropdown: it sits at the toolbar's left.
                  toolbarStart={repos.length > 1 && !repoTabs && <RepoSelect cwd={cwd} repos={[...list.shown, ...list.hidden]} repo={repo} onPick={pickRepo} />} />}
          </div>
          {pr != null && !diff && (
            <PrView key={`${repo}:${pr}`} root={repo} remote="origin" number={pr} theme={theme} onConfirm={setConfirm}
              onOpenCommit={(oid) => { setPrsOpen(false); void showCommit(oid); }} />
          )}
          {diff?.media && (
            <MediaDiff key={diff.id} path={diff.media.file} oldBytes={diff.media.old} newBytes={diff.media.nu}
              gone={diff.media.gone} oldLabel={diff.media.labels[0]} newLabel={diff.media.labels[1]} />
          )}
          {diff?.conflict && (
            <ConflictView key={diff.id} root={repo} row={diff.conflict} onConfirm={setConfirm} onResolved={() => setDiff(null)} />
          )}
          {diff && !diff.media && !diff.conflict && (
            <MonacoDiff key={`${diff.id}:${diff.v ?? 0}`} path={diff.path} head={diff.base} work={diff.mod}
              sideBySide={settings.diffSideBySide} readOnly rev={0} onChange={() => {}}
              hunkAction={diff.row ? hunkAction(diff.row) : undefined} />
          )}
        </div>
      </div>
      {(commit || prsOpen) && (
        <>
          {/* On the right, as GitKraken has it: the graph reads left to right into the details. */}
          <div {...sideDrag} title="Drag to resize"
            className="my-3 w-1.5 shrink-0 cursor-col-resize rounded-full transition-colors hover:bg-[var(--accent)]" />
          <div className="my-1.5 mr-1.5 flex min-h-0 shrink-0 flex-col overflow-hidden rounded-[10px] border border-subtle bg-panel" style={{ width: sideW }}>
            {prsOpen ? (
              <PrList root={repo} selected={pr} onOpen={(n, title) => { setPr(n); setPrTitle(title); setDiff(null); }} onClose={() => setPrsOpen(false)} />
            ) : commit && commit.hash === WORKTREE ? (
              <WorkPanel key={repo} root={repo} theme={theme} onConfirm={setConfirm}
                selected={diff?.id.startsWith(`${WORKTREE}:`) ? diff.id.slice(WORKTREE.length + 1) : undefined}
                treeView={treeView} onToggleTree={() => setTreeView((t) => !t)}
                onOpenFile={(r) => void openStatusDiff(r)} onClose={() => setCommit(null)}
                onFileHistory={(r) => showFile(r.rel)}
                // In the workspace's editor, as a ctrl-clicked path in a terminal opens: Terminals
                // claims the event and switches to that editor.
                onEditFile={(r) => window.dispatchEvent(new CustomEvent("deck-term-open", { detail: { path: r.path }, cancelable: true }))} />
            ) : commit && <CommitPanel
              view={commit} root={repo} busy={busy} treeView={treeView} onToggleTree={() => setTreeView((t) => !t)} theme={theme}
              onOpenFile={(f) => void openDiff(commit.hash, commit.meta?.parents[0] ?? `${commit.hash}^`, f)}
              // The working-tree file, in the workspace's editor tab — as the uncommitted rows do.
              onEditFile={(f) => window.dispatchEvent(new CustomEvent("deck-term-open", { detail: { path: `${repo}/${f.rel}` }, cancelable: true }))}
              onClose={() => setCommit(null)}
              // The file whose diff is open (its id is `<hash>:<rel>`), else the one whose history shows.
              onFileHistory={(f) => showFile(f.rel)}
              activeRel={diff?.id.startsWith(`${commit.hash}:`) ? diff.id.slice(commit.hash.length + 1) : file ?? undefined}
            />}
          </div>
        </>
      )}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
