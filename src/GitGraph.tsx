import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, RefreshCw, GitBranch, Copy, Undo2, GitCommitHorizontal, Tag, RotateCcw, Check, Filter, GitMerge, Trash2, AlertTriangle,
  ArrowDownToLine, ArrowUpFromLine, GitBranchPlus, Archive, ArchiveRestore, LogIn, Pencil, Search, X, Laptop, Cloud, GitPullRequest, History,
} from "lucide-react";
import {
  gitLogGraph, gitCheckoutDetach, gitRefs, openExternal, gitStatus, gitFileBytes, fsReadBytes, gitCheckout, gitCheckoutTrack, gitCheckoutNew, type GraphCommit, type CommitFile, type GitRef,
} from "../shim/bridge.js";
import { gitBranchAt, gitRevert, gitCherryPick, gitResetTo, gitTag, gitMergeAs, gitContinueOp, gitBranchDelete, gitBranchDeleteRemote, gitTagDelete, gitTagPush, gitTagDeleteRemote, gitPushBranch, gitRemotes, gitPendingOp, gitAbortOp, gitFetch, gitBranchRename, gitRebase, gitPull, gitPullRebase, gitPush, gitStash, gitStashPop, gitHead, gitStashApply, gitStashDrop, gitStashClear } from "./git";
import { ContextMenu, type MenuEntry } from "../shim/ui.js";
import { NamePrompt, type NamePromptState } from "../shim/ui.js";
import { useResize } from "../shim/ui.js";
import { GIT_CHANGED, undoStore, type UndoEntry } from "./WorkPanel";
import { useRepoWatch } from "./watch";
import { PrDialog } from "./PrDialog";
import { chordFor, onKey, onKeys, pushScope } from "../shim/ui.js";
import { formatChord, parseChord } from "../shim/ui.js";
import { updateEditorSettings, useEditorSettings } from "../shim/ui.js";
import { GRAPH_FONT_SIZES } from "./util";
import { byHead, PR_CHANGED, primaryRemote, type PrInfo, type PrState } from "./prs";
import { usePrHost } from "./prhost";
import { decodeText } from "../shim/ui.js";

/**
 * The search of every git graph on screen, the most recently used last.
 *
 * Ctrl+F belongs to a visible graph wherever the focus is — after a click on the toolbar, a tab
 * or another pane, it otherwise reached WebView2's find-in-page bar. While any graph is on screen
 * the plugin's scope is claimed and the search binding opens the last-used one's search.
 */
const onScreen: (() => void)[] = [];
let releaseOnScreen: (() => void) | null = null;
function setOnScreen(open: () => void, shown: boolean) {
  const i = onScreen.indexOf(open);
  if (i >= 0) onScreen.splice(i, 1);
  if (shown) onScreen.push(open);
  if (onScreen.length && !releaseOnScreen) {
    const offScope = pushScope("plugin:git");
    // Except where the focus is in something with a Ctrl+F of its own (the editor's find, a
    // terminal, a text box): taking the key there broke search in every pane beside a graph.
    const offKey = onKey("plugin:git:search", () => onScreen[onScreen.length - 1]?.(),
      () => !document.activeElement?.closest("input, textarea, [contenteditable=true], .monaco-editor, .xterm, .cm-editor"));
    releaseOnScreen = () => { offScope(); offKey(); };
  } else if (!onScreen.length && releaseOnScreen) {
    releaseOnScreen();
    releaseOnScreen = null;
  }
}

// VS Code scmGraph swimlane constants + palette (ported from scmHistory.ts).
// W is wide enough for an avatar node (r = 7) to sit in a lane without touching its neighbour.
const W = 16, H = 28, R = 5;
/** Commits per page — must match `-n` in log_graph_sync (fsedit.rs). */
const PAGE = 2000;
// Width of the ref column left of the graph. Fixed, so the graph and every subject start at the
// same x on every row; a commit with more tags than fit scrolls them rather than widening.
// Width of the ref column left of the graph, dragged by the divider between them. Per machine
// rather than per repo — it is a window-size preference, not something about the project.
const REF_COL_KEY = "deck-graph-ref-col";
const REF_COL_DEFAULT = 128;
const loadRefCol = () => {
  const n = Number(localStorage.getItem(REF_COL_KEY));
  return Number.isFinite(n) && n > 0 ? n : REF_COL_DEFAULT;
};
const COLORS = ["#FFB000", "#DC267F", "#994F00", "#40B0A6", "#B66DFF"];
const rot = (i: number, n: number) => ((i % n) + n) % n;

// Avatar palette — deeper than the lane colours so white initials stay readable on them.
const AVATAR_COLORS = ["#3b7dd8", "#4a9d5f", "#b5651d", "#8b5cf6", "#c2410c", "#0891b2", "#be185d", "#65a30d"];

/**
 * A stable colour and initials for one person.
 *
 * Keyed on the email rather than the name: the same person commits as "Hasan" and "Hasan Zarif"
 * across machines, and two contributors can share a first name. No network request — a Gravatar
 * lookup would be a per-row fetch to a third party, which is a lot of traffic and a privacy
 * question for a panel that just needs to tell rows apart at a glance.
 */
function avatarOf(name: string, email: string) {
  const key = (email || name).trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0])
    : (parts[0]?.slice(0, 2) ?? "?");
  return { color: AVATAR_COLORS[rot(h, AVATAR_COLORS.length)], initials: initials.toUpperCase() };
}


/**
 * The uncommitted changes, drawn as a row above HEAD.
 *
 * Not a commit, so it has no hash of its own; this stands in for one wherever the graph keys by
 * hash. Its file list comes from `git status`, and its "diff" is the working tree against HEAD.
 */
export const WORKTREE = "worktree";

/**
 * The two sides of one file's diff in a commit: as the commit left it, and as its parent had it.
 * For WORKTREE the new side is the file on disk. Shared by every place that opens these diffs, so
 * they cannot disagree on what the uncommitted row means.
 */
export async function commitFileSides(root: string, hash: string, parent: string | undefined, file: CommitFile) {
  const work = hash === WORKTREE && "path" in file;
  // As bytes, decoded by the file's own mark: a UTF-16 file failed a UTF-8 read and came back
  // empty. Commit diffs are read-only, so nothing is written back in another encoding.
  const text = (b: Promise<Uint8Array>) => b.then((x) => decodeText(x).text).catch(() => "");
  const [mod, base] = await Promise.all([
    text(work ? fsReadBytes(String(file.path)) : gitFileBytes(root, hash, file.rel)),
    parent ? text(gitFileBytes(root, parent, file.old ?? file.rel)) : Promise.resolve(""),
  ]);
  return { mod, base, title: `${file.rel.split("/").pop()} (${hash === WORKTREE ? "Working Tree" : hash.slice(0, 7)})` };
}

type MergeStyle = "no-ff" | "ff" | "squash";
/**
 * The merge dialog's choice of style. A component of its own, at module level, so picking redraws
 * only it; the choice reaches the merge through `pick`, which the dialog's confirm then reads.
 */
function MergeStyleChoice({ pick }: { pick: (s: MergeStyle) => void }) {
  const [style, setStyle] = useState<MergeStyle>("no-ff");
  const opt = (v: MergeStyle, label: string, sub: string) => (
    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-white/5">
      <input type="radio" checked={style === v} onChange={() => { setStyle(v); pick(v); }} className="mt-1" />
      <span><span className="text-text-primary">{label}</span><span className="block text-[11px] text-text-muted">{sub}</span></span>
    </label>
  );
  return (
    <div className="mt-3 space-y-0.5">
      {opt("no-ff", "Merge commit", "Always records the merge, so the branch stays visible in the graph")}
      {opt("ff", "Fast-forward if possible", "No extra commit when the target has not moved since")}
      {opt("squash", "Squash", "The branch's changes as one new commit")}
    </div>
  );
}

/** A pull request's state as its icon's colour, GitHub's own palette. */
const PR_COLOR: Record<PrState, string> = { passing: "#3fb950", failing: "#f85149", pending: "#d29922", none: "var(--text-secondary)" };

/** The author as the commit's node, ringed in its lane's colour — GitKraken's graph reads this way. */
function AvatarNode({ x, ring, name, email }: { x: number; ring: string; name: string; email: string }) {
  const { color, initials } = avatarOf(name, email);
  return (
    <g>
      <title>{email ? `${name} <${email}>` : name}</title>
      <circle cx={x} cy={H / 2} r={7} fill={color} stroke={ring} strokeWidth={1.5} />
      <text x={x} y={H / 2} dy="0.35em" textAnchor="middle" fontSize={6.5} fontWeight={600} fill="#fff"
        style={{ pointerEvents: "none" }}>{initials}</text>
    </g>
  );
}

interface Lane { id: string; color: string }
interface RowVM {
  commit: GraphCommit;
  input: Lane[];   // swimlanes entering this row (from the row above)
  output: Lane[];  // swimlanes leaving to the row below
  circle: number;  // column index of this commit's dot
  circleColor: string;
}

// Port of toISCMHistoryItemViewModelArray (the model half; no ref-color map / incoming-
// outgoing). Each row's input = previous output; the lane matching the commit becomes its
// first parent (keeping color); extra parents open new lanes with cycled colors.
function buildViewModels(commits: GraphCommit[]): RowVM[] {
  let colorIndex = -1;
  const vms: RowVM[] = [];
  for (const commit of commits) {
    const prev = vms.length ? vms[vms.length - 1] : undefined;
    const input: Lane[] = (prev?.output ?? []).map((l) => ({ ...l }));
    const output: Lane[] = [];
    let firstParentAdded = false;
    if (commit.parents.length > 0) {
      for (const node of input) {
        if (node.id === commit.hash) {
          if (!firstParentAdded) { output.push({ id: commit.parents[0], color: node.color }); firstParentAdded = true; }
          continue;
        }
        output.push({ ...node });
      }
    }
    for (let i = firstParentAdded ? 1 : 0; i < commit.parents.length; i++) {
      colorIndex = rot(colorIndex + 1, COLORS.length);
      output.push({ id: commit.parents[i], color: COLORS[colorIndex] });
    }
    const inputIndex = input.findIndex((n) => n.id === commit.hash);
    const circle = inputIndex !== -1 ? inputIndex : input.length;
    const circleColor = circle < output.length ? output[circle].color
      : circle < input.length ? input[circle].color : COLORS[0];
    vms.push({ commit, input, output, circle, circleColor });
  }
  return vms;
}

// Per-row SVG (ported from renderSCMHistoryItemGraph, expressed as JSX paths).
/**
 * `link` draws the line from the ref column's pill to this commit's node. `hover` is the ghost
 * label's line, shown only while the row is hovered, as the ghost label itself is.
 */
function RowGraph({ vm, lanes, link, reach }: { vm: RowVM; lanes: number; link?: "on" | "faint" | "hover"; reach?: boolean }) {
  const { input, output, circle, circleColor } = vm;
  const paths: { d: string; color: string }[] = [];
  const line = (x: number, y1: number, y2: number, color: string) => paths.push({ d: `M ${x} ${y1} V ${y2}`, color });

  let outIdx = 0;
  for (let index = 0; index < input.length; index++) {
    const color = input[index].color;
    if (input[index].id === vm.commit.hash) {
      if (index !== circle) {
        paths.push({ color, d: `M ${W * (index + 1)} 0 A ${W} ${W} 0 0 1 ${W * index} ${W} H ${W * (circle + 1)}` });
      } else { outIdx++; }
    } else if (outIdx < output.length && input[index].id === output[outIdx].id) {
      if (index === outIdx) {
        line(W * (index + 1), 0, H, color);
      } else {
        paths.push({ color, d:
          `M ${W * (index + 1)} 0 V ${H / 2 - R} ` +
          `A ${R} ${R} 0 0 1 ${W * (index + 1) - R} ${H / 2} ` +
          `H ${W * (outIdx + 1) + R} ` +
          `A ${R} ${R} 0 0 0 ${W * (outIdx + 1)} ${H / 2 + R} ` +
          `V ${H}` });
      }
      outIdx++;
    }
  }
  // Remaining parents (merge edges out).
  for (let i = 1; i < vm.commit.parents.length; i++) {
    let pIdx = -1;
    for (let k = output.length - 1; k >= 0; k--) if (output[k].id === vm.commit.parents[i]) { pIdx = k; break; }
    if (pIdx === -1) continue;
    paths.push({ color: output[pIdx].color,
      d: `M ${W * pIdx} ${H / 2} A ${W} ${W} 0 0 1 ${W * (pIdx + 1)} ${H} M ${W * pIdx} ${H / 2} H ${W * (circle + 1)}` });
  }
  // Vertical through the dot (in from top if this commit was expected; out to bottom if it has a parent).
  if (vm.input.findIndex((n) => n.id === vm.commit.hash) !== -1) line(W * (circle + 1), 0, H / 2, vm.input[vm.input.findIndex((n) => n.id === vm.commit.hash)].color);
  if (vm.commit.parents.length > 0) line(W * (circle + 1), H / 2, H, circleColor);

  const width = Math.max(lanes, 1) * W + W;
  return (
    <svg width={width} height={H} className="shrink-0" style={{ display: "block" }}>
      {link && (
        <path d={`M 0 ${H / 2} H ${W * (circle + 1)}`} fill="none" stroke={circleColor} strokeWidth={1.5}
          strokeOpacity={link === "on" ? 1 : 0.5}
          className={link === "hover" ? "opacity-0 group-hover/row:opacity-100" : undefined} />
      )}
      {/* The selected commit: a line from its node out to the message, which picks it up. */}
      {reach && <path d={`M ${W * (circle + 1)} ${H / 2} H ${Math.max(lanes, 1) * W + W}`} fill="none" stroke={circleColor} strokeWidth={1.5} />}
      {paths.map((p, i) => <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={1.5} />)}
      {vm.commit.hash === WORKTREE
        // Hollow and dotted: work that is not a commit yet.
        ? <circle cx={W * (circle + 1)} cy={H / 2} r={6} fill="var(--bg-card)" stroke={circleColor} strokeWidth={1.5} strokeDasharray="2.5 2" />
        // A merge stays a plain dot, so the eye can tell where branches joined from who wrote what.
        : vm.commit.parents.length > 1
          ? <circle cx={W * (circle + 1)} cy={H / 2} r={3.5} fill={circleColor} stroke="var(--bg-card)" strokeWidth={1} />
          : <AvatarNode x={W * (circle + 1)} ring={circleColor} name={vm.commit.author} email={vm.commit.email} />}
    </svg>
  );
}

// Classify a decoration ref → a small colored pill.
/** What a decoration entry actually is, so a menu can offer the right things for it. */
type RefKind = "local" | "remote" | "tag" | "stash" | "head";
interface ParsedRef { kind: RefKind; label: string; color: string; current: boolean }

function parseRef(ref: string): ParsedRef {
  // "HEAD -> main" is the checked-out branch; the arrow is git's, not part of the name.
  if (ref.startsWith("HEAD -> ")) return { kind: "local", label: ref.slice(8), color: "#3794ff", current: true };
  if (ref === "HEAD") return { kind: "head", label: "HEAD", color: "#3794ff", current: true };
  if (ref.startsWith("tag: ")) return { kind: "tag", label: ref.slice(5), color: "#e2c08d", current: false };
  if (ref.startsWith("stash@")) return { kind: "stash", label: ref, color: "#4ec9b0", current: false };
  if (ref.includes("/")) return { kind: "remote", label: ref, color: "#c586c0", current: false };
  return { kind: "local", label: ref, color: "#3794ff", current: false };
}

/**
 * A commit's refs as GitKraken shows them: a local branch and its remote copies are one pill
 * ("main" with a laptop and a cloud) rather than two. Current branch first, then local, remote,
 * tags. `origin/HEAD` is dropped — a pointer to the default branch, not a branch.
 */
interface RefGroup { name: string; local?: ParsedRef; remotes: ParsedRef[]; tag?: ParsedRef; other?: ParsedRef; current: boolean }
function groupRefs(refs: string[]): RefGroup[] {
  const groups = new Map<string, RefGroup>();
  for (const raw of refs) {
    const p = parseRef(raw);
    if (p.kind === "remote" && p.label.endsWith("/HEAD")) continue;
    const key = p.kind === "local" ? p.label
      : p.kind === "remote" ? p.label.slice(p.label.indexOf("/") + 1)
      : `${p.kind}:${p.label}`;
    // A remote's copy alone is named like the branch only for origin: with a second remote the
    // bare name was ambiguous — the testbed showed two pills reading "main" on different commits.
    const g = groups.get(key) ?? { name: p.kind === "remote" && !p.label.startsWith("origin/") ? p.label : key, remotes: [], current: false };
    if (p.kind === "local") g.local = p;
    else if (p.kind === "remote") g.remotes.push(p);
    else if (p.kind === "tag") g.tag = p;
    else g.other = p;
    g.current ||= p.current;
    groups.set(key, g);
  }
  // origin's copy first: the cloud opens it, and it is the one a PR is about.
  for (const g of groups.values()) g.remotes.sort((a, b) => Number(b.label.startsWith("origin/")) - Number(a.label.startsWith("origin/")));
  const rank = (g: RefGroup) => (g.current ? 0 : g.local ? 1 : g.remotes.length ? 2 : g.tag ? 3 : 4);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}
const isBranch = (g: RefGroup) => !!(g.local || g.remotes.length);

// Persist graph state across tab switches (the component unmounts when you leave the
// tab). Keyed by workspace root so switching workspaces starts fresh.
// `expanded` is the selected row: a commit's details and files show in the editor's sidebar,
// not under the row.
interface GraphState { commits: GraphCommit[]; expanded: string | null; query: string; picked: string[] }
const graphStore = new Map<string, GraphState>();

export function GitGraph({ root, onOpenCommit, onConfirm, onRepoChanged, rel, focusHash, toolbarStart, onShowPrs, onClearFile }: {
  root: string;
  /** Show the pull-request list beside the graph — the toolbar's Pull requests button. */
  onShowPrs?: () => void;
  /** Shown at the toolbar's left — the pane's repository picker. */
  toolbarStart?: React.ReactNode;
  /** Leave one file's history for the whole graph: the × on the toolbar's file chip. */
  onClearFile?: () => void;
  /** Show a commit in the sidebar's Commit panel. For the uncommitted row there is no commit for
   *  the panel to look up, so its files come along. */
  onOpenCommit?: (c: GraphCommit, files?: CommitFile[], log?: GraphCommit[]) => void;
  /** Ask before something that cannot simply be undone. The graph has no dialog of its own —
   *  the editor owns one already, and a second would sit at a different place in the tree. */
  onConfirm?: (o: { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; acknowledge?: boolean; onConfirm: () => void }) => void;
  /** The working tree or HEAD moved: the editor re-reads git state and the open files. */
  onRepoChanged?: () => void;
  /** Limit the log to one file's history (follows renames). Omit for the whole repo. */
  rel?: string;
  /** Expand this commit on open, for arriving from the status bar's blame indicator. */
  focusHash?: string;
}) {
  // Keyed by root AND path: a file's history is a different log from the repo's, and sharing
  // one entry would have each overwrite the other's commits on every switch.
  const storeKey = rel ? `${root} ${rel}` : root;
  const saved = graphStore.get(storeKey);
  const [commits, setCommitsState] = useState<GraphCommit[]>(saved?.commits ?? []);
  const [loading, setLoading] = useState(!saved);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpandedState] = useState<string | null>(saved?.expanded ?? null);
  const [query, setQueryState] = useState(saved?.query ?? "");
  const [searchOpen, setSearchOpen] = useState(!!saved?.query);
  // Which refs the log walks. Empty = every ref, which is the default view.
  const [picked, setPickedState] = useState<string[]>(saved?.picked ?? []);
  const [branchMenu, setBranchMenu] = useState<{ x: number; y: number } | null>(null);
  const [refs, setRefs] = useState<GitRef[] | null>(null);
  // Uncommitted files, as the WORKTREE row's file list. Not for one file's history, which is
  // about commits only. A file both staged and changed again is listed by git twice; once here.
  const [changes, setChanges] = useState<CommitFile[]>([]);
  const loadChanges = () => {
    if (rel) return;
    void gitStatus(root)
      // `path` rides along for commitFileSides: `rel` is from the repo root, which need not be
      // the folder the graph was opened on, so only git knows where the file on disk is.
      .then((rows) => setChanges([...new Map(rows.map((r) => [r.rel, { rel: r.rel, path: r.path, letter: r.letter, adds: 0, dels: 0 }])).values()]))
      .catch(() => setChanges([]));
  };
  useEffect(loadChanges, [root, rel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ref-column width. min 0 so the column can be dismissed entirely for a repo with no tags
  // worth showing; max leaves room for the graph and the subject at any sane window size.
  const [refCol, refHandle] = useResize({
    initial: loadRefCol(), min: 0, max: 480, direction: "horizontal",
  });
  useEffect(() => { try { localStorage.setItem(REF_COL_KEY, String(refCol)); } catch { /* private mode */ } }, [refCol]);

  // Persist every piece back to the store so it survives an unmount.
  const persist = (patch: Partial<GraphState>) => {
    const cur = graphStore.get(storeKey) ?? { commits, expanded, query, picked };
    graphStore.set(storeKey, { ...cur, ...patch });
  };
  const setCommits = (c: GraphCommit[]) => { setCommitsState(c); persist({ commits: c }); };
  const setExpanded = (h: string | null) => { setExpandedState(h); persist({ expanded: h }); };
  const setQuery = (q: string) => { setQueryState(q); persist({ query: q }); };

  useEffect(() => {
    if (saved) return; // already loaded — keep the cached commits + selection
    setLoading(true);
    gitLogGraph(root, 0, rel, picked).then((c) => { setCommits(c); setLoading(false); }).catch(() => { setCommits([]); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, rel]);

  // Refs for the filter menu, read once the menu is first opened rather than on mount: a graph
  // that is never filtered should not pay for a second git call.
  useEffect(() => {
    if (!branchMenu || refs) return;
    void gitRefs(root).then(setRefs).catch(() => setRefs([]));
  }, [branchMenu, refs, root]);

  /** Re-walk the log with a new ref selection. Empty selection = the whole repo again. */
  const applyFilter = async (next: string[]) => {
    setPickedState(next);
    persist({ picked: next });
    setLoading(true);
    const c = await gitLogGraph(root, 0, rel, next).catch(() => []);
    setCommits(c);
    setLoading(false);
  };

  // Arriving from the status bar's blame indicator: select that commit, rather than making the
  // user find it in the log. The editor has already put it in the sidebar.
  useEffect(() => {
    if (focusHash && expanded !== focusHash) setExpanded(focusHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHash]);

  // A click selects the row and shows the commit in the sidebar. The details and files used to
  // open under the row as well, which repeated the sidebar and pushed the rest of the log away.
  const select = (c: GraphCommit) => {
    setExpanded(c.hash);
    onOpenCommit?.(c, c.hash === WORKTREE ? changes : undefined, commits);
  };

  // Re-read the log from disk. Keeps the selected row and the filter.
  const reload = async () => {
    loadChanges();
    // A merge or rebase can be started, finished or abandoned outside Deck (a terminal), so the
    // conflict banner is re-checked on every reload, not only after the graph's own actions.
    void checkPending();
    const c = await gitLogGraph(root, 0, rel, picked).catch(() => null);
    if (c) setCommits(c);
  };
  // The uncommitted row's panel staged or committed: re-read. Through a ref, so the listener is
  // added once per repo and still calls the reload that knows the current filter.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === root) void reloadRef.current(); };
    window.addEventListener(GIT_CHANGED, on);
    return () => window.removeEventListener(GIT_CHANGED, on);
  }, [root]);

  // Git run outside Deck (a checkout, commit or pull in a terminal) fires nothing here, and a
  // graph shown again comes from the cache. So whenever it may be looked at again — shown from the
  // cache, the window focused, the pointer back over it — ask where HEAD is (one cheap git call,
  // at most every 2s) and re-read the log only if it moved. Otherwise the toolbar's actions took
  // the branch from a log that was out of date, and PR opened one from the branch just left.
  // ponytail: HEAD only. Commits on other branches, or fetched, still wait for Refresh; watching
  // .git/refs would catch those too.
  const headChecked = useRef(0);
  const syncHeadRef = useRef(() => {});
  syncHeadRef.current = () => {
    if (Date.now() - headChecked.current < 2000) return;
    headChecked.current = Date.now();
    const shown = commits.find((c) => c.refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> ")));
    if (!shown && picked.length) return; // a branch filter that leaves HEAD out: nothing to compare
    const branch = shown?.refs.find((r) => r.startsWith("HEAD -> "))?.slice(8) ?? "";
    void gitHead(root).then((h) => { if (!shown || shown.hash !== h.hash || branch !== h.branch) void reloadRef.current(); }).catch(() => {});
  };
  useEffect(() => {
    if (saved) syncHeadRef.current();
    const on = () => { if (!document.hidden) syncHeadRef.current(); };
    window.addEventListener("focus", on);
    document.addEventListener("visibilitychange", on);
    return () => { window.removeEventListener("focus", on); document.removeEventListener("visibilitychange", on); };
  }, [root, rel]); // eslint-disable-line react-hooks/exhaustive-deps

  // The refresh button: fetch, then re-read. Without the fetch this only redraws refs already on
  // disk, so commits pushed by someone else never appear however many times it is pressed — which
  // reads as the button being broken rather than as the repo being out of date.
  //
  // The local reload runs even when the fetch fails: being offline, or on a repo with no remote,
  // is not a reason to refuse to redraw what is already here.
  const refresh = async () => {
    setRefreshing(true);
    let failure: unknown;
    try {
      await gitFetch(root);
    } catch (e) {
      failure = e;
    }
    await reload();
    loadPrs();
    setRefreshing(false);
    if (failure !== undefined) {
      onConfirm?.({
        title: "Could not fetch from the remote",
        body: (
          <>
            <p className="mb-2">The graph below is up to date with this machine, but may be missing commits from the remote.</p>
            <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed">
              {String(failure).replace(/^Error:\s*/, "")}
            </pre>
          </>
        ),
        confirmLabel: "OK",
        danger: false,
        acknowledge: true,
        onConfirm: () => {},
      });
    }
  };

  const loadMore = async () => {
    setMore(true);
    const next = await gitLogGraph(root, commits.length, rel, picked).catch(() => []);
    setCommits([...commits, ...next]); setMore(false);
  };

  // ---- Acting on a commit ---------------------------------------------------
  const [menu, setMenu] = useState<{ x: number; y: number; commit: GraphCommit } | null>(null);
  // Confirmation of a copy, shown on the row that was copied — the clipboard gives no feedback of
  // its own, and a menu that closes silently leaves you unsure whether it worked.
  const [copied, setCopied] = useState<string | null>(null);
  // The branch/tag name prompt, in Deck's chrome rather than the OS's.
  const [naming, setNaming] = useState<NamePromptState | null>(null);

  /**
   * Run a git action, then re-read the log and tell the editor its git state moved.
   *
   * `undo` says how to take the action back, given where HEAD was before it — read from git, not
   * from the loaded log, which can be stale. An action with no undo clears the last one: what
   * that would have undone may no longer be where it was.
   */
  const act = async (fn: () => Promise<unknown>, failed: string, undo?: (before: Head) => UndoEntry | null) => {
    setMenu(null);
    try {
      const before = undo ? await gitHead(root).catch(() => null) : null;
      await fn();
      const u = before && undo ? undo(before) : null;
      const after = u ? await gitHead(root).catch(() => null) : null;
      if (u && after) undoStore.set(root, { ...u, at: after.hash }); else undoStore.delete(root);
      // reload, not refresh: the action just moved local refs, so there is nothing on the remote
      // to go and ask about, and a fetch would put the network on the path of every menu item.
      // Through the event, so an open uncommitted-changes panel and Source Control re-read too;
      // this graph's own listener is what reloads it.
      window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root }));
      await checkPending();
      onRepoChanged?.();
    } catch (e) {
      // A failed action may still have moved things (a merge stopped on conflicts), so the last
      // undo can no longer be trusted to land where it says.
      undoStore.delete(root);
      // And re-read: a merge stopped on conflicts has changed the tree — the conflicted files are
      // the uncommitted row's, and the banner below needs them on screen to be acted on.
      window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root }));
      // The failure is usually a conflict, which leaves the repo mid-operation — so find out
      // before reporting, and the banner appears alongside the message explaining it.
      void checkPending();
      // git's own stderr, which says what actually went wrong — a conflict, a dirty tree, a tag
      // that already exists — far better than anything this layer could infer.
      //
      // Through the editor's dialog rather than alert(): a webview's alert is an OS modal that
      // takes focus away from the window and leaves the cursor hidden until it is dismissed.
      onConfirm?.({
        title: failed,
        // A node, not a string: git's messages are several lines and a string body renders in a
        // <p>, where the newlines collapse into one run-on paragraph.
        body: (
          <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed">
            {String(e).replace(/^Error:\s*/, "")}
          </pre>
        ),
        confirmLabel: "OK",
        danger: false,
        acknowledge: true,
        onConfirm: () => {},
      });
    }
  };

  // The undos the actions below record.
  type Head = { hash: string; branch: string };
  /** Back to where HEAD was: the branch it was on, or the commit when it was detached. */
  const back = (b: Head) => () => (b.branch ? gitCheckout(root, b.branch) : gitCheckoutDetach(root, b.hash));
  /** The current branch back to the commit it was at. --keep: refuses rather than lose local changes. */
  const rewind = (label: string) => (b: Head): UndoEntry => ({ label, run: () => gitResetTo(root, b.hash, "keep") });
  /**
   * Merge `source` into `target`, switching to `target` first when it is not checked out — what a
   * drop of one branch onto another asks for. The style is picked in the dialog.
   */
  const mergeInto = (source: string, target: string) => {
    const here = !target || target === currentBranch();
    const picked = { style: "no-ff" as MergeStyle };
    ask({
      title: `Merge ${source} into ${target || "HEAD"}?`,
      body: (
        <>
          {!here && <p className="mb-1">Switches to {target} first.</p>}
          <p>If the two changed the same lines, the merge stops with conflicts to resolve.</p>
          <MergeStyleChoice pick={(st) => { picked.style = st; }} />
        </>
      ),
      confirmLabel: "Merge",
      run: () => {
        const tip = tipOf(target);
        void act(async () => { if (!here) await gitCheckout(root, target); await gitMergeAs(root, source, picked.style); }, "Merge failed.",
          here ? rewind("merge")
            // Undone: the target back where it was, then back to the branch you were on.
            : (b) => (tip ? { label: "merge", run: async () => { await gitResetTo(root, tip, "keep"); await back(b)(); } } : null));
      },
    });
  };
  /** Rebase `branch` onto `onto`, switching to `branch` first when it is not checked out. */
  const rebaseOnto = (branch: string, onto: string) => {
    const here = !branch || branch === currentBranch();
    ask({
      title: `Rebase ${branch || "HEAD"} onto ${onto}?`,
      body: `${here ? "" : `Switches to ${branch} first. `}Replays its commits on top of ${onto}. They become new commits — if the branch is already pushed, the next push will need to be forced. A conflict stops the rebase part way; the banner above the graph offers to continue or abandon it.`,
      confirmLabel: "Rebase",
      run: () => {
        const tip = tipOf(branch);
        void act(async () => { if (!here) await gitCheckout(root, branch); await gitRebase(root, onto); }, "Rebase failed.",
          here ? rewind("rebase")
            : (b) => (tip ? { label: "rebase", run: async () => { await gitResetTo(root, tip, "keep"); await back(b)(); } } : null));
      },
    });
  };
  const tipOf = (ref: string) => commits.find((c) => c.refs.some((r) => r === ref || r === `HEAD -> ${ref}`))?.hash;
  const undo = undoStore.get(root);
  const runUndo = async () => {
    if (!undo) return;
    const now = await gitHead(root).catch(() => null);
    if (now?.hash !== undo.at) {
      undoStore.delete(root);
      window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root })); // redraw the button
      onConfirm?.({
        title: `Cannot undo the ${undo.label}`,
        body: "The repository has moved since — a commit or checkout made somewhere else — so undoing now would land in the wrong place.",
        confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {},
      });
      return;
    }
    void act(undo.run, `Could not undo the ${undo.label}.`);
  };

  const copy = (text: string, hash: string) => {
    setMenu(null);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(hash);
      setTimeout(() => setCopied((h) => (h === hash ? null : h)), 1200);
    }).catch(() => {});
  };

  const [refMenu, setRefMenu] = useState<{ x: number; y: number; ref: ParsedRef } | null>(null);
  // The refs folded into a row's "+N", each with its own actions as a submenu.
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number; groups: RefGroup[] } | null>(null);
  const [remotes, setRemotes] = useState<string[]>([]);
  useEffect(() => { void gitRemotes(root).then(setRemotes).catch(() => setRemotes([])); }, [root]);

  // A merge, revert or cherry-pick that hits a conflict stops half-way and stays that way. Until
  // it is finished or abandoned every later git command fails, and nothing else in the UI says
  // why — so the graph checks after each action and shows the way out.
  const [pending, setPending] = useState("");
  // The toolbar: which network action is running (for its spinner), and the pull menu.
  const [net, setNet] = useState<"" | "pull" | "push">("");
  const [pullMenu, setPullMenu] = useState<{ x: number; y: number } | null>(null);
  const [stashMenu, setStashMenu] = useState<{ x: number; y: number } | null>(null);
  // The pull-request form, for a branch (and a target, when it came from a drop).
  const [prFor, setPrFor] = useState<{ head: string; base?: string } | null>(null);
  // Open pull requests (or GitLab merge requests) by head branch, for the pills' icons. Empty
  // without the host's CLI.
  const prHost = usePrHost(root);
  const prNoun = prHost?.noun ?? "pull request";
  const [prs, setPrs] = useState<Map<string, PrInfo>>(new Map());
  const loadPrs = () => {
    if (rel || !prHost) return;
    void prHost.list("all").then((rows) => setPrs(byHead(rows))).catch(() => setPrs(new Map()));
  };
  useEffect(loadPrs, [prHost, rel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === root) loadPrs(); };
    window.addEventListener(PR_CHANGED, on);
    return () => window.removeEventListener(PR_CHANGED, on);
  }, [root, rel, prHost]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging one branch pill onto another: merge, rebase or a pull request between the two.
  // Pointer events, not HTML5 drag and drop, which this window cannot use (see dragrow).
  const dragFrom = useRef<{ g: RefGroup; x: number; y: number } | null>(null);
  const suppressClick = useRef(false); // the click that ends a drag must not also open a menu
  const dragging = useRef(false);
  const [drag, setDrag] = useState<{ g: RefGroup; x: number; y: number } | null>(null);
  const [dropMenu, setDropMenu] = useState<{ x: number; y: number; from: RefGroup; to: RefGroup } | null>(null);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragFrom.current;
      if (!d) return;
      // A few pixels of slack, so a click with a shaky hand is still a click.
      if (!dragging.current && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 5) return;
      dragging.current = true;
      setDrag({ g: d.g, x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => {
      const d = dragFrom.current;
      dragFrom.current = null;
      if (!d || !dragging.current) return;
      dragging.current = false;
      setDrag(null);
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      const name = (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-ref-group]") as HTMLElement | null)?.dataset.refGroup;
      const to = name && name !== d.g.name
        ? commitsRef.current.flatMap((c) => groupRefs(c.refs)).find((g) => g.name === name && isBranch(g))
        : undefined;
      if (to) setDropMenu({ x: e.clientX, y: e.clientY, from: d.g, to });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);
  const checkPending = () => gitPendingOp(root).then(setPending).catch(() => setPending(""));
  useEffect(() => { void checkPending(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [root]);

  /**
   * What can be done with one ref.
   *
   * The current branch is deliberately sparse: you cannot merge a branch into itself, and git
   * refuses to delete the branch you are on, so offering either would only produce an error.
   */
  const refItems = (p: ParsedRef): MenuEntry[] => {
    const remote = primaryRemote(remotes);
    const rows: MenuEntry[] = [];

    // Switching branch asks nothing: git refuses on its own when local changes would be
    // overwritten, and that refusal is reported like any other failure.
    if (p.kind === "local" && !p.current) {
      rows.push({ label: "Check out", icon: LogIn, onClick: () => void act(() => gitCheckout(root, p.label), "Checkout failed.", (b) => ({ label: "checkout", run: back(b) })) });
    }
    if (p.kind === "remote") {
      rows.push({
        label: "Check out as local branch", icon: LogIn,
        subLabel: "Creates it tracking this remote branch, or switches to it if it exists",
        onClick: () => void act(() => gitCheckoutTrack(root, p.label), "Checkout failed.", (b) => ({ label: "checkout", run: back(b) })),
      });
    }

    if (!p.current && (p.kind === "local" || p.kind === "remote")) {
      rows.push({ label: `Merge ${p.label} into current branch`, icon: GitMerge, onClick: () => mergeInto(p.label, currentBranch()) });
      rows.push({ label: `Rebase current branch onto ${p.label}`, onClick: () => rebaseOnto(currentBranch(), p.label) });
    }
    if (p.kind === "local" || p.kind === "remote") {
      rows.push({
        label: `Create ${prNoun}…`, icon: GitPullRequest,
        onClick: () => setPrFor({ head: p.kind === "remote" ? p.label.slice(p.label.indexOf("/") + 1) : p.label }),
      });
    }

    if (p.kind === "local") {
      rows.push({
        label: "Rename…", icon: Pencil,
        onClick: () => setNaming({
          title: "Rename branch", subtitle: p.label, initial: p.label, confirmLabel: "Rename",
          onSave: (to) => void act(() => gitBranchRename(root, p.label, to), "Could not rename the branch.",
            () => ({ label: "rename", run: () => gitBranchRename(root, to, p.label) })),
        }),
      });
      rows.push({
        label: "Push to " + remote, icon: GitBranch,
        onClick: () => ask({
          title: `Push ${p.label}?`,
          body: `Pushes ${p.label} to ${remote} and sets it as the upstream.`,
          confirmLabel: "Push",
          run: () => act(() => gitPushBranch(root, remote, p.label), "Push failed."),
        }),
      });
      if (!p.current) {
        rows.push("sep");
        rows.push({
          label: "Delete branch", icon: Trash2, danger: true,
          onClick: () => ask({
            title: `Delete ${p.label}?`,
            body: `Deletes the local branch. Git refuses if it holds commits that are not merged anywhere else — the error will say so, and "Delete even if unmerged" is the way past it.`,
            confirmLabel: "Delete",
            danger: true,
            run: () => { const tip = tipOf(p.label); return act(() => gitBranchDelete(root, p.label, false), "Could not delete the branch.",
              () => (tip ? { label: "branch delete", run: () => gitBranchAt(root, p.label, tip) } : null)); },
          }),
        });
        rows.push({
          label: "Delete even if unmerged", subLabel: "Discards commits only on this branch", danger: true,
          onClick: () => ask({
            title: `Force-delete ${p.label}?`,
            body: `Any commit that exists only on ${p.label} is lost. Git will not warn a second time.`,
            confirmLabel: "Force delete",
            danger: true,
            run: () => { const tip = tipOf(p.label); return act(() => gitBranchDelete(root, p.label, true), "Could not delete the branch.",
              () => (tip ? { label: "branch delete", run: () => gitBranchAt(root, p.label, tip) } : null)); },
          }),
        });
      }
    }

    if (p.kind === "remote") {
      // "origin/feat/x" — the remote is the first segment, the branch is the rest.
      const slash = p.label.indexOf("/");
      const rem = p.label.slice(0, slash), name = p.label.slice(slash + 1);
      rows.push("sep");
      rows.push({
        label: `Delete ${name} on ${rem}`, icon: Trash2, danger: true,
        onClick: () => ask({
          title: `Delete ${name} on ${rem}?`,
          body: `This removes the branch from the remote. Anyone else working from it will find it gone.`,
          confirmLabel: "Delete on remote",
          danger: true,
          run: () => act(() => gitBranchDeleteRemote(root, rem, name), "Could not delete the remote branch."),
        }),
      });
    }

    if (p.kind === "tag") {
      rows.push({
        label: "Push tag to " + remote, icon: Tag,
        onClick: () => ask({
          title: `Push ${p.label}?`,
          body: `Pushes the tag to ${remote}.`,
          confirmLabel: "Push tag",
          run: () => act(() => gitTagPush(root, remote, p.label), "Could not push the tag."),
        }),
      });
      rows.push("sep");
      rows.push({
        label: "Delete tag", icon: Trash2, danger: true,
        onClick: () => ask({
          title: `Delete ${p.label}?`,
          body: `Deletes the tag locally. If it has been pushed it stays on the remote until deleted there too.`,
          confirmLabel: "Delete",
          danger: true,
          run: () => { const at = tipOf(`tag: ${p.label}`); return act(() => gitTagDelete(root, p.label), "Could not delete the tag.",
            () => (at ? { label: "tag delete", run: () => gitTag(root, p.label, at) } : null)); },
        }),
      });
      rows.push({
        label: `Delete tag on ${remote}`, danger: true,
        onClick: () => ask({
          title: `Delete ${p.label} on ${remote}?`,
          body: `Removes the tag from the remote. Anyone who already fetched it keeps their copy.`,
          confirmLabel: "Delete on remote",
          danger: true,
          run: () => act(() => gitTagDeleteRemote(root, remote, p.label), "Could not delete the remote tag."),
        }),
      });
    }

    // A stash node: its changes show by selecting the row, like any commit's; the menu is what
    // can be done with it. Not undoable — a dropped stash is gone from the reflog.
    if (p.kind === "stash") {
      const n = Number(/\{(\d+)\}/.exec(p.label)?.[1] ?? 0);
      rows.push({ label: "Apply stash", icon: ArchiveRestore, subLabel: "Keeps it in the list", onClick: () => void act(() => gitStashApply(root, n), "Could not apply the stash.") });
      rows.push({ label: "Pop stash", subLabel: "Applies it and drops it", onClick: () => void act(() => gitStashPop(root, n), "Could not pop the stash.") });
      rows.push("sep");
      rows.push({
        label: "Drop stash", icon: Trash2, danger: true,
        onClick: () => ask({
          title: `Drop ${p.label}?`, body: "The stashed changes are deleted. This cannot be undone.",
          confirmLabel: "Drop", danger: true,
          run: () => act(() => gitStashDrop(root, n), "Could not drop the stash."),
        }),
      });
    }

    if (!rows.length) rows.push({ label: "Nothing to do with this ref", disabled: true });
    return rows;
  };

  /**
   * One pill in the ref column: a branch (local and remote together), a tag, or HEAD. Clicking it
   * opens what can be done with it; the cloud opens the remote copy's actions instead.
   *
   * `ghost` is the faded label on a commit with no ref of its own, naming the branch it is on.
   */
  const openRef = (p: ParsedRef | undefined) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();          // never select the row underneath
    if (suppressClick.current) return;
    if (!p || p.kind === "head") return; // nothing useful to offer for HEAD alone
    setRefMenu({ x: e.clientX, y: e.clientY, ref: p });
  };
  // A render function, not a component declared in here: that would be a new type each render,
  // remounting every pill — and losing a click whose mouse-down caused a render.
  const pill = (g: RefGroup, color: string, ghost?: boolean) => {
    const primary = g.local ?? g.remotes[0] ?? g.tag ?? g.other;
    const tint = g.tag && !isBranch(g) ? g.tag.color : color;
    const pr = !ghost && isBranch(g) ? prs.get(g.name) : undefined;
    return (
      <span
        data-ref-group={!ghost && isBranch(g) ? g.name : undefined}
        onPointerDown={(e) => { if (!ghost && isBranch(g) && e.button === 0) dragFrom.current = { g, x: e.clientX, y: e.clientY }; }}
        onClick={openRef(primary)} onContextMenu={openRef(primary)}
        title={ghost ? `On ${g.name}` : [g.local?.label, ...g.remotes.map((r) => r.label), g.tag && `tag ${g.tag.label}`].filter(Boolean).join(" · ")}
        className={"flex h-[18px] min-w-0 shrink select-none items-center gap-1 rounded px-1.5 text-[11px] font-medium text-text-primary "
          + (ghost ? "opacity-50" : "cursor-pointer hover:brightness-125")}
        style={{ background: tint + "40" }}>
        {g.current && <Check size={11} className="shrink-0" />}
        {g.tag && !isBranch(g) && <Tag size={10} className="shrink-0" />}
        <span className="truncate">{g.name}</span>
        {g.local && <Laptop size={11} className="shrink-0 opacity-70" />}
        {g.remotes.length > 0 && (
          <Cloud size={11} className="shrink-0 opacity-70 hover:opacity-100"
            onClick={openRef(g.remotes[0])} onContextMenu={openRef(g.remotes[0])} />
        )}
        {pr && (
          <span title={`${prHost?.sign ?? "#"}${pr.number} ${pr.title}${pr.isDraft ? " (draft)" : ""} — ${pr.state === "none" ? "open" : pr.state}. Click to open.`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void openExternal(pr.url); }}
            className={"flex shrink-0 items-center " + (pr.isDraft ? "opacity-60" : "")}>
            <GitPullRequest size={11} style={{ color: PR_COLOR[pr.state] }} />
          </span>
        )}
      </span>
    );
  };

  /** The branch-filter menu: every ref, ticked when it is in the walk. */
  const branchItems = (): MenuEntry[] => {
    if (!refs) return [{ label: "Loading refs…", disabled: true }];
    const toggle = (name: string) => {
      const next = picked.includes(name) ? picked.filter((r) => r !== name) : [...picked, name];
      void applyFilter(next);
    };
    // "All branches" is the empty selection rather than every ref ticked: --all also reaches refs
    // that are not branches or tags, and reproducing that as a list would drift from what git does.
    const rows: MenuEntry[] = [
      { label: "All branches", dot: picked.length === 0 ? "ok" : "off",
        onClick: () => { setBranchMenu(null); void applyFilter([]); } },
    ];
    const group = (kind: GitRef["kind"], heading: string) => {
      const list = refs.filter((r) => r.kind === kind);
      if (!list.length) return;
      rows.push("sep");
      rows.push({ label: heading, disabled: true });
      for (const r of list) {
        rows.push({
          label: r.name,
          subLabel: r.summary || undefined,
          dot: picked.includes(r.name) ? "ok" : "off",
          // ContextMenu closes on any click, so each pick applies on its own and building a
          // multi-ref filter means reopening. Acceptable: the common filters are one branch, or
          // back to all. A menu that stayed open would need its own component.
          onClick: () => toggle(r.name),
        });
      }
    };
    group("local", "Local");
    group("remote", "Remote");
    group("tag", "Tags");
    return rows;
  };

  const menuItems = (c: GraphCommit): MenuEntry[] => {
    const short = c.hash.slice(0, 7);
    return [
      { label: "Check out this commit", subLabel: "Detached HEAD", icon: GitCommitHorizontal,
        onClick: () => ask({
          title: `Check out ${short}?`,
          body: `“${c.subject}” — this leaves you on a detached HEAD, not on a branch. Commits made here belong to no branch until you create one.`,
          confirmLabel: "Check out",
          run: () => act(() => gitCheckoutDetach(root, c.hash), "Checkout failed.", (b) => ({ label: "checkout", run: back(b) })),
        }) },
      // These two name the thing first. The prompt IS the confirmation — it states the commit,
      // and cancelling it does nothing — so a second dialog asking the same question would only
      // train you to click through both.
      { label: "Branch from here…", icon: GitBranch, onClick: () => {
        setMenu(null);
        setNaming({
          title: "New branch", subtitle: `at ${short} — ${c.subject}`,
          placeholder: "feature/my-branch", confirmLabel: "Create branch",
          onSave: (name) => void act(() => gitBranchAt(root, name, c.hash), "Could not create the branch.",
            () => ({ label: "new branch", run: () => gitBranchDelete(root, name, true) })),
        });
      } },
      { label: "Tag this commit…", icon: Tag, onClick: () => {
        setMenu(null);
        setNaming({
          title: "New tag", subtitle: `at ${short} — ${c.subject}`,
          placeholder: "v1.0.0", confirmLabel: "Create tag",
          onSave: (name) => void act(() => gitTag(root, name, c.hash), "Could not create the tag.",
            () => ({ label: "tag", run: () => gitTagDelete(root, name) })),
        });
      } },
      "sep",
      // Both write a NEW commit rather than rewriting history, so neither needs confirming: the
      // way back is the same as for any commit.
      { label: "Revert this commit", subLabel: "Commits the inverse", icon: Undo2,
        onClick: () => ask({
          title: `Revert ${short}?`,
          body: `“${c.subject}” — this commits the inverse onto the current branch. If the change cannot be applied cleanly the repository is left mid-revert, with conflicts to resolve.`,
          confirmLabel: "Revert",
          run: () => act(() => gitRevert(root, c.hash), "Revert failed.", rewind("revert")),
        }) },
      { label: "Cherry-pick onto current branch", icon: GitCommitHorizontal,
        onClick: () => ask({
          title: `Cherry-pick ${short}?`,
          body: `“${c.subject}” — this copies the change onto the current branch as a new commit. A conflict leaves the repository mid-cherry-pick.`,
          confirmLabel: "Cherry-pick",
          run: () => act(() => gitCherryPick(root, c.hash), "Cherry-pick failed.", rewind("cherry-pick")),
        }) },
      "sep",
      { label: "Copy SHA", icon: Copy, onClick: () => copy(c.hash, c.hash) },
      { label: "Copy message", icon: Copy, onClick: () => copy(c.subject + (c.body ? `\n\n${c.body}` : ""), c.hash) },
      "sep",
      // Reset moves the branch and can throw away commits, so every mode is confirmed and the
      // body says exactly what happens to the working tree in that mode.
      { label: "Reset current branch to here", icon: RotateCcw, danger: true, children: [
        { label: "Soft", subLabel: "Keep the index and working tree",
          onClick: () => confirmReset(c, "soft", "Changes since this commit stay staged.") },
        { label: "Mixed", subLabel: "Keep the working tree",
          onClick: () => confirmReset(c, "mixed", "Changes since this commit stay in the working tree, unstaged.") },
        { label: "Hard", subLabel: "Discard everything after it", danger: true,
          onClick: () => confirmReset(c, "hard", "Every change since this commit is destroyed, including anything uncommitted in the working tree. This cannot be undone from here.") },
      ] },
    ];
  };

  /**
   * Confirm before anything that changes the repository, then run it.
   *
   * Every write goes through here — checkout, branch, tag, revert, cherry-pick, reset. The reason
   * is not that each is dangerous in the same degree, but that a context menu sits under the
   * cursor: a mis-click on a row is one pixel away from a mis-click on "revert", and the dialog
   * is what turns a slip into a question. `danger` is reserved for the ones that destroy work, so
   * a red button still means something.
   *
   * With no dialog wired the action is refused rather than run silently — an unconfirmable write
   * is the one case where doing nothing is clearly right.
   */
  const ask = (o: { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; run: () => void }) => {
    setMenu(null);
    if (!onConfirm) return;
    onConfirm({ title: o.title, body: o.body, confirmLabel: o.confirmLabel, danger: o.danger, onConfirm: o.run });
  };

  // ---- Toolbar --------------------------------------------------------------
  const currentBranch = () => commits.flatMap((c) => c.refs).find((r) => r.startsWith("HEAD -> "))?.slice(8) ?? "";
  const network = async (kind: "pull" | "push", fn: () => Promise<unknown>, failed: string, undo?: (b: Head) => UndoEntry) => {
    setNet(kind);
    await act(fn, failed, undo);
    setNet("");
  };
  // A branch never pushed has no upstream, and a plain push refuses; push it and set one instead,
  // which is what the push would have been for.
  const push = () => network("push", async () => {
    try { await gitPush(root); }
    catch (e) {
      const branch = currentBranch();
      if (!branch || !/no upstream/i.test(String(e))) throw e;
      await gitPushBranch(root, primaryRemote(remotes), branch);
    }
  }, "Push failed.");
  const pullItems = (): MenuEntry[] => [
    { label: "Pull", subLabel: "Fast-forward only", icon: ArrowDownToLine, onClick: () => void network("pull", () => gitPull(root), "Pull failed.", rewind("pull")) },
    { label: "Pull with rebase", subLabel: "Replays your local commits on top", onClick: () => void network("pull", () => gitPullRebase(root), "Pull failed.", rewind("pull")) },
    "sep",
    { label: "Fetch all", icon: RefreshCw, onClick: () => void refresh() },
  ];
  // The Stash button's menu: the kinds Source Control offered, and clearing the list.
  const stashAs = (kind: "" | "untracked" | "staged", message = "") =>
    void act(() => gitStash(root, kind, message), "Stash failed.", () => ({ label: "stash", run: () => gitStashPop(root) }));
  const stashItems = (): MenuEntry[] => [
    { label: "Stash", subLabel: "Tracked changes", icon: Archive, disabled: !changes.length, onClick: () => stashAs("") },
    { label: "Stash, including untracked", disabled: !changes.length, onClick: () => stashAs("untracked") },
    { label: "Stash staged only", disabled: !changes.length, onClick: () => stashAs("staged") },
    { label: "Stash with a message…", disabled: !changes.length, onClick: () => setNaming({
      title: "Stash", subtitle: "Tracked changes, under a message", placeholder: "work in progress on…",
      confirmLabel: "Stash", onSave: (m) => stashAs("", m),
    }) },
    "sep",
    { label: "Drop all stashes…", icon: Trash2, danger: true, onClick: () => ask({
      title: "Drop every stash?", body: "All stashed changes are deleted. This cannot be undone.",
      confirmLabel: "Drop all", danger: true, run: () => act(() => gitStashClear(root), "Could not clear the stashes."),
    }) },
  ];
  const newBranch = () => setNaming({
    title: "New branch", subtitle: `from ${currentBranch() || "HEAD"}, and switch to it`,
    placeholder: "feature/my-branch", confirmLabel: "Create branch",
    onSave: (name) => void act(() => gitCheckoutNew(root, name), "Could not create the branch.",
      (b) => ({ label: "new branch", run: async () => { await back(b)(); await gitBranchDelete(root, name, true); } })),
  });
  // Labels drop in a narrow pane, leaving the icons and their tooltips.
  const toolBtn = (label: string, icon: React.ReactNode, onClick: (e: React.MouseEvent<HTMLButtonElement>) => void,
    o: { disabled?: boolean; title?: string } = {}) => (
    <button title={o.title ?? label} disabled={o.disabled} onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[12px] text-text-secondary hover:bg-white/5 hover:text-text-primary disabled:opacity-40">
      {icon}{(!listW || listW >= 480) && <span>{label}</span>}
    </button>
  );
  // Closing the search clears it, so nothing stays dimmed by a query no longer on screen.
  const closeSearch = () => { setQuery(""); setSearchOpen(false); };

  const confirmReset = (c: GraphCommit, mode: "soft" | "mixed" | "hard", what: string) =>
    ask({
      title: `Reset ${mode} to ${c.hash.slice(0, 7)}?`,
      // The commit above what happens to the tree, so the sentence about losing work sits next to
      // the commit it is about rather than as one run-on line.
      body: `“${c.subject}” — ${what}`,
      confirmLabel: mode === "hard" ? "Reset and discard" : "Reset",
      danger: mode === "hard", // only the mode that destroys work gets the red button
      // Undone in kind: a soft or mixed reset left the work in the index or the tree, and the same
      // reset back puts HEAD over it again. A hard one left a clean tree, which --keep restores.
      run: () => void act(() => gitResetTo(root, c.hash, mode), "Reset failed.",
        (b) => ({ label: "reset", run: () => gitResetTo(root, b.hash, mode === "hard" ? "keep" : mode) })),
    });
  // The layout is the expensive part of this component: lanes, the HEAD walk and the branch
  // labels, over every loaded commit. Memoised, because scrolling re-renders this component on
  // every scroll event (the window of rows follows scrollTop), and so does each keystroke in the
  // search box; neither changes the layout.
  const hasWork = changes.length > 0;
  const { head, vms, maxLanes, inHead, onBranch } = useMemo(() => {
    // One file's history is drawn as a single line, each commit followed by the next older one that
    // touched the file. Its real parents mostly did not touch it, are not in the list, and left
    // every lane open — a staircase of lines running off the bottom, with the fading all wrong.
    const shown = rel ? commits.map((c, i) => ({ ...c, parents: commits[i + 1] ? [commits[i + 1].hash] : [] })) : commits;
    // The uncommitted row goes first and names HEAD as its parent, so the lane builder draws it
    // into HEAD's lane wherever that is. HEAD outside the current branch filter: no row.
    const head = shown.find((c) => c.refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> ")));
    const withWork = head && hasWork
      ? [{ hash: WORKTREE, parents: [head.hash], author: "", email: "", date: "", subject: "Uncommitted changes", body: "", refs: [] }, ...shown]
      : shown;
    const vms = buildViewModels(withWork); // lanes computed from the FULL set
    const maxLanes = vms.reduce((m, v) => Math.max(m, v.input.length, v.output.length), 1);
    // The branch each commit is on, for the ghost label: a branch's name runs down its first-parent
    // line until another branch claims it. The log is in topological order, so a commit's children
    // are always seen first, and the newest child to reach it wins — as in GitKraken.
    // What the checked-out branch contains: HEAD and every commit it reaches. The rest — work on
    // other branches not merged in — is drawn faded, as GitKraken does, so the history you are on
    // reads first. No HEAD in the walk (a branch filter that leaves it out): nothing fades.
    const inHead = new Set<string>();
    if (head) {
      const byHash = new Map(shown.map((c) => [c.hash, c]));
      for (const stack = [head.hash]; stack.length;) {
        const h = stack.pop()!;
        if (inHead.has(h)) continue;
        inHead.add(h);
        for (const p of byHash.get(h)?.parents ?? []) stack.push(p);
      }
    }
    const onBranch = new Map<string, string>();
    for (const c of shown) {
      const name = groupRefs(c.refs).find(isBranch)?.name ?? onBranch.get(c.hash);
      if (!name) continue;
      onBranch.set(c.hash, name);
      if (c.parents[0] && !onBranch.has(c.parents[0])) onBranch.set(c.parents[0], name);
    }
    return { head, vms, maxLanes, inHead, onBranch };
  }, [commits, rel, hasWork]);
  const listRef = useRef<HTMLDivElement>(null);
  // Font size, as a zoom on each row: the lanes, avatars, pills, dates and text are all drawn at
  // the 13px design size, and zooming the row scales every one of them together, so nothing is
  // drawn twice. Everything measured OUTSIDE a row — the scroll window, the spacers, the ref
  // column's handle — works in screen px, so those multiply by S, and refCol stays in screen px
  // (divided by S inside the row) so the drag handle tracks the pointer one to one.
  const { graphFontSize, mouseWheelZoom } = useEditorSettings();
  const S = graphFontSize / 13;
  const RH = H * S;
  // Ctrl+wheel over the list steps through the same sizes Settings offers. A native listener,
  // because React's wheel handler is passive and cannot stop the page from scrolling.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !mouseWheelZoom) return;
    const on = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const i = GRAPH_FONT_SIZES.indexOf(graphFontSize);
      const at = i === -1 ? GRAPH_FONT_SIZES.indexOf(13) : i;
      const next = GRAPH_FONT_SIZES[Math.min(GRAPH_FONT_SIZES.length - 1, Math.max(0, at + (e.deltaY < 0 ? 1 : -1)))];
      if (next !== graphFontSize) updateEditorSettings({ graphFontSize: next });
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [graphFontSize, mouseWheelZoom, loading, commits.length === 0]);
  // The list's width, so the optional columns can drop out in a narrow pane rather than
  // squeezing the message to a few characters. Measured — Tailwind 3 has no container queries.
  const [listW, setListW] = useState(0);
  // Only the rows on screen are rendered: 2000 rows, each with an SVG, made a large repo slow to
  // open and to scroll. Rows are a fixed H tall, so the window is plain arithmetic.
  const [view, setView] = useState({ top: 0, h: 0 });
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setListW(e.contentRect.width);
      setView((v) => ({ ...v, h: e.contentRect.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, commits.length === 0]);
  // The message keeps 260px; the date, then the SHA, take what is left. No author column: the
  // node is the author's avatar, with the name on hover and in the Commit panel.
  const spare = listW ? (listW - refCol) / S - (8 + maxLanes * W + W + 8 + 260 + 8) : Infinity;
  const showDate = spare >= 88;
  const showSha = spare >= 88 + 72;
  const q = query.trim().toLowerCase();
  // Search marks the matches and dims the rest rather than removing rows: taking the rows out
  // took the lanes with them, and a match without its branch around it says little.
  const isMatch = (c: GraphCommit) => c.hash !== WORKTREE
    && (c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.hash.startsWith(q));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- isMatch depends only on q
  const matches = useMemo(() => q ? vms.filter((v) => isMatch(v.commit)) : [], [vms, q]);

  const go = (c: GraphCommit) => {
    select(c);
    // By index, not by element: the row may be outside the rendered window.
    const el = listRef.current, i = vms.findIndex((v) => v.commit.hash === c.hash);
    if (!el || i < 0) return;
    if (i * RH < el.scrollTop) el.scrollTop = i * RH;
    else if ((i + 1) * RH > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * RH - el.clientHeight;
  };
  /** Enter / Shift+Enter in the search box: the next or previous match after the selected row. */
  const nextMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    const at = vms.findIndex((v) => v.commit.hash === expanded);
    const to = dir === 1
      ? matches.find((m) => vms.indexOf(m) > at) ?? matches[0]
      : [...matches].reverse().find((m) => vms.indexOf(m) < at) ?? matches[matches.length - 1];
    go(to.commit);
  };
  const searchInput = useRef<HTMLInputElement>(null);
  const openSearch = () => {
    setSearchOpen(true);
    // Already open: autoFocus does not fire again, so focus it here (after it has rendered).
    requestAnimationFrame(() => searchInput.current?.select());
  };

  // The rebindable shortcuts (declared in plugin.tsx, under the plugin's scope). Claimed while the commit list
  // has focus and released when it loses it: single letters are only safe as shortcuts where
  // nothing is being typed, and a graph in the editor and another in a pane must not both answer.
  // Through a ref, so a claim made several renders ago still runs today's state.
  const keyActions = useRef<Record<string, () => void>>({});
  keyActions.current = {
    "plugin:git:show": () => { const c = vms.find((v) => v.commit.hash === expanded)?.commit; if (c) select(c); },
    "plugin:git:escape": () => { if (searchOpen || query) closeSearch(); else setExpanded(null); },
    "plugin:git:search-alt": openSearch,
    "plugin:git:next-match": () => nextMatch(1),
    "plugin:git:prev-match": () => nextMatch(-1),
    "plugin:git:head": () => { if (head) go(head); },
  };
  const releaseKeys = useRef<(() => void) | null>(null);
  // On screen or not, observed rather than assumed: a graph in a zone that is scrolled away, or
  // in a tab that is not showing, must not take Ctrl+F from the one you are looking at.
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;
  const [opener] = useState(() => () => openSearchRef.current());
  const shown = useRef(false);
  // Something outside Deck changing the repo (an agent, a terminal) re-reads it, while the graph
  // is on screen (watch.ts); coming into view catches up at once.
  const watch = useRepoWatch(root, shown);
  const rootRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      shown.current = e.isIntersecting;
      setOnScreen(opener, e.isIntersecting);
      if (e.isIntersecting) watch.current();
    });
    io.observe(el);
    return () => { io.disconnect(); shown.current = false; setOnScreen(opener, false); };
  }, [opener]);
  const claimKeys = () => {
    if (shown.current) setOnScreen(opener, true);   // the one you just used gets the next Ctrl+F
    if (releaseKeys.current) return;
    const offScope = pushScope("plugin:git");
    const offKeys = onKeys(Object.fromEntries(
      Object.keys(keyActions.current).map((id) => [id, () => keyActions.current[id]?.()])));
    releaseKeys.current = () => { offScope(); offKeys(); releaseKeys.current = null; };
  };
  // Unmounted while focused (a tab switch): blur never fires, so release here too.
  useEffect(() => () => releaseKeys.current?.(), []);

  // j/k or the arrows walk the rows, Home/End jump to the ends — GitKraken's keys.
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "z" && e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); void runUndo(); return; }
    const at = vms.findIndex((v) => v.commit.hash === expanded);
    const to = e.key === "ArrowDown" || e.key === "j" ? Math.min(at + 1, vms.length - 1)
      : e.key === "ArrowUp" || e.key === "k" ? Math.max(at - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? vms.length - 1
      : null;
    if (to === null || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    go(vms[to].commit);
  };
  // The rendered window, with a screen's worth of rows either side so a fast scroll does not
  // show blank space before React catches up. Before the first measurement: one screenful.
  const first = Math.max(0, Math.floor(view.top / RH) - 20);
  const last = Math.min(vms.length, Math.ceil((view.top + (view.h || 1000)) / RH) + 20);
  const dimmed = (c: GraphCommit) => q !== "" && !isMatch(c);

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-text-muted"><Loader2 size={16} className="mr-2 animate-spin" /> Loading graph…</div>;
  if (!commits.length) return <div className="flex h-full items-center justify-center text-sm text-text-muted">No commit history.</div>;

  return (
    <div ref={rootRef} className="flex h-full flex-col" onPointerEnter={() => syncHeadRef.current()}>
      {/* The toolbar: GitKraken's actions in the middle, labelled; search, the branch filter and
          refresh at the right. The search box only appears when asked for — it is used now and
          then, and a permanent input took the width the actions need. */}
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-subtle px-2 py-1.5">
        <div className="flex min-w-0 items-center">
          {rel ? (
            // One file's history: say which, and the way back to the whole graph.
            <span className="flex min-w-0 items-center gap-1.5 rounded px-2 py-0.5 text-[12px] text-text-primary"
              style={{ background: "var(--accent-soft)" }} title={rel}>
              <History size={12} className="shrink-0" />
              <span className="truncate">History: {rel}</span>
              {onClearFile && (
                <button onClick={onClearFile} title="Back to the whole graph" className="shrink-0 text-text-muted hover:text-text-primary"><X size={12} /></button>
              )}
            </span>
          ) : toolbarStart}
        </div>
        {/* Not for one file's history, which is a reading view. */}
        {!rel ? (
          <div className="flex items-center gap-0.5">
            {toolBtn("Undo", <Undo2 size={14} />, () => void runUndo(),
              { disabled: !undo || !!net, title: undo ? `Undo ${undo.label} (Ctrl+Z)` : "Nothing to undo" })}
            {toolBtn("Pull", net === "pull" ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />,
              (e) => { const r = e.currentTarget.getBoundingClientRect(); setPullMenu({ x: r.left, y: r.bottom + 4 }); }, { disabled: !!net })}
            {toolBtn("Push", net === "push" ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpFromLine size={14} />,
              () => void push(), { disabled: !!net })}
            {toolBtn("Branch", <GitBranchPlus size={14} />, newBranch, { title: "New branch" })}
            {/* The branch asked of git at the click, not taken from the log, which can be behind. */}
            {toolBtn("PR", <GitPullRequest size={14} />, () => void gitHead(root).catch(() => null).then((h) => { const b = h?.branch || currentBranch(); if (b) setPrFor({ head: b }); }),
              { disabled: !currentBranch(), title: `Create a ${prNoun} for the current branch` })}
            {toolBtn("Stash", <Archive size={14} />,
              (e) => { const r = e.currentTarget.getBoundingClientRect(); setStashMenu({ x: r.left, y: r.bottom + 4 }); },
              { title: "Stash changes" })}
            {toolBtn("Pop", <ArchiveRestore size={14} />, () => void act(() => gitStashPop(root), "Pop failed."),
              { title: "Pop the latest stash" })}
          </div>
        ) : <span />}
        <div className="flex items-center justify-end gap-0.5">
          {onShowPrs && !rel && (
            <button onClick={onShowPrs} title={`${prHost?.kind === "gitlab" ? "Merge requests" : "Pull requests"}: review, merge, close`}
              className="shrink-0 rounded p-1.5 text-text-muted hover:bg-white/5 hover:text-text-primary">
              <GitPullRequest size={14} />
            </button>
          )}
          <button onClick={() => (searchOpen ? closeSearch() : openSearch())} title={`Search (message, author, hash) — ${formatChord(chordFor("plugin:git:search"))}`}
            className={"shrink-0 rounded p-1.5 hover:bg-white/5 " + (searchOpen ? "text-[var(--accent)]" : "text-text-muted hover:text-text-primary")}>
            <Search size={14} />
          </button>
          {/* Branch filter. Hidden for a single file's history: that view follows one path through
              whatever refs contain it, so narrowing by branch has nothing to act on. */}
          {!rel && (
            <button
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setBranchMenu({ x: r.right, y: r.bottom + 4 }); }}
              title={picked.length ? `Showing ${picked.length} ref${picked.length === 1 ? "" : "s"}` : "All branches"}
              className={"flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-white/5 "
                + (picked.length ? "text-[var(--accent)]" : "text-text-muted hover:text-text-primary")}>
              <Filter size={13} />
              {picked.length > 0 && <span className="tabular-nums">{picked.length}</span>}
            </button>
          )}
          <button onClick={refresh} disabled={refreshing} title="Fetch and refresh graph"
            className="shrink-0 rounded p-1.5 text-text-muted hover:bg-white/5 hover:text-text-primary disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />
          </button>
        </div>
      </div>
      {searchOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-2 py-1.5">
          <input ref={searchInput} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search message, author, or hash"
            onKeyDown={(e) => {
              // The list's scope is released while the box has focus, so the search chord would
              // otherwise reach WebView2 and open its find-in-page bar over the whole window.
              if (parseChord(e.nativeEvent) === chordFor("plugin:git:search")) { e.preventDefault(); e.currentTarget.select(); return; }
              if (e.key === "Enter") { e.preventDefault(); nextMatch(e.shiftKey ? -1 : 1); }
              if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
            }}
            title="Enter: next match · Shift+Enter: previous · Esc: close"
            className="vscode-input min-w-0 flex-1 px-2.5 placeholder:text-text-muted" />
          {q && <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{matches.length} match{matches.length === 1 ? "" : "es"}</span>}
          <button onClick={closeSearch} title="Close search" className="shrink-0 rounded p-1 text-text-muted hover:bg-white/5 hover:text-text-primary"><X size={13} /></button>
        </div>
      )}
      {/* Mid-operation: every other git command will fail until this is resolved, and the only
          other sign is a file with conflict markers in it. */}
      {pending && (
        <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-3 py-2 text-[12px]"
          style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)" }}>
          <AlertTriangle size={13} style={{ color: "var(--danger)" }} className="shrink-0" />
          <span className="min-w-0 flex-1 text-text-secondary">
            This {pending} stopped on conflicts. Resolve the marked files and stage them, then continue — or abandon it.
          </span>
          <button onClick={() => void act(() => gitContinueOp(root, pending), `Could not continue the ${pending}.`)}
            title="Stage the resolved files first"
            className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-white" style={{ background: "var(--accent)" }}>
            Continue
          </button>
          <button
            onClick={() => ask({
              title: `Abandon the ${pending}?`,
              body: `Puts the repository back exactly as it was before the ${pending} started. Any conflict resolution done so far is discarded.`,
              confirmLabel: `Abandon ${pending}`,
              danger: true,
              run: () => act(() => gitAbortOp(root, pending), `Could not abandon the ${pending}.`),
            })}
            className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-white"
            style={{ background: "var(--danger)" }}>
            Abandon
          </button>
        </div>
      )}
      {/* The handle is a SIBLING of the scrolling list, not a child of it: an absolutely
          positioned element inside an overflow-auto box belongs to that box's scrollable
          content and would scroll out of view with the rows. Being a sibling also keeps it
          clear of the row click handler, so a drag never toggles a commit open. */}
      <div className="relative min-h-0 flex-1">
        <div {...refHandle}
          title="Drag to resize the branch and tag column"
          className="absolute top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-white/20"
          // Centred on the boundary: it sits in the gap-2 between the column and the graph,
          // so it never overlaps the first lane.
          style={{ left: 8 * S + refCol - 2 }}
        />
      {/* Focusable, so the row keys work once a row has been clicked. */}
      <div ref={listRef} tabIndex={0} onKeyDown={onListKey} onFocus={claimKeys} onBlur={() => releaseKeys.current?.()}
        onScroll={(e) => { const top = e.currentTarget.scrollTop; setView((v) => ({ ...v, top })); }}
        className="scroll-thin h-full overflow-auto text-[13px] outline-none">
        {/* Spacers stand in for the rows above and below the window, so the scrollbar is true. */}
        <div style={{ height: first * RH }} />
        {vms.slice(first, last).map((vm) => {
          const isOpen = expanded === vm.commit.hash;
          const isWork = vm.commit.hash === WORKTREE;
          const groups = groupRefs(vm.commit.refs);
          const ghostName = isWork ? undefined : onBranch.get(vm.commit.hash);
          return (
            <div key={vm.commit.hash} style={S === 1 ? undefined : { zoom: S }}>
              <div onClick={() => select(vm.commit)} data-hash={vm.commit.hash}
                onContextMenu={(e) => { e.preventDefault(); if (!isWork) setMenu({ x: e.clientX, y: e.clientY, commit: vm.commit }); }}
                className={"group/row flex h-[28px] cursor-pointer items-center gap-2 px-2 transition-opacity "
                  + (isOpen ? "" : "hover:bg-elev ") + (dimmed(vm.commit) ? "opacity-35" : "")}
                // Selected: a band in the commit's lane colour, stronger behind the message. The
                // commit you are on (HEAD) gets a fainter one and a lane-coloured edge, so the
                // current branch stands out without competing with the selection.
                style={isOpen ? { background: vm.circleColor + "1a" }
                  : vm.commit.hash === head?.hash ? { background: vm.circleColor + "0f", boxShadow: `inset 2px 0 0 ${vm.circleColor}` }
                  : undefined}>
                {/* Refs live LEFT of the graph, in their own fixed column. Inline before the
                    subject they pushed each message right by however many tags that commit
                    happened to carry, so the subjects never lined up and the eye had no column
                    to read down. Right-aligned so a pill always sits against the graph. */}
                {/* title: at any finite width a long ref still clips, and right-aligned it is the
                    START of the name that goes. Hovering gives the full list for free. */}
                {/* The ref column and the graph touch, so a pill's line runs straight into its node. */}
                <div className="flex shrink-0 items-center">
                  <div className="flex shrink-0 items-center justify-end gap-1 overflow-hidden" style={{ width: refCol / S }}>
                    {groups.length > 0 && pill(groups[0], vm.circleColor)}
                    {groups.length > 1 && (
                      <span title={groups.slice(1).map((g) => g.name).join(", ")}
                        onClick={(e) => { e.stopPropagation(); setMoreMenu({ x: e.clientX, y: e.clientY, groups: groups.slice(1) }); }}
                        className="flex h-[18px] shrink-0 cursor-pointer items-center rounded border border-subtle px-1 text-[10px] text-text-muted hover:text-text-primary">
                        +{groups.length - 1}
                      </span>
                    )}
                    {!groups.length && ghostName && (
                      <span className={"min-w-0 " + (isOpen ? "flex" : "hidden group-hover/row:flex")}>
                        {pill({ name: ghostName, remotes: [], current: false }, vm.circleColor, true)}
                      </span>
                    )}
                  </div>
                  <RowGraph vm={vm} lanes={maxLanes}
                    link={groups.length ? "on" : ghostName ? (isOpen ? "faint" : "hover") : undefined} reach={isOpen} />
                </div>
                {/* The message, date and SHA share one box so the selection's tint runs to the row's
                    end. -ml-2 pl-2 / -mr-2 pr-2 when selected: it starts where the node's line
                    ends, across the gap, and reaches the edge past the row's padding. */}
                <div className={"flex min-w-0 flex-1 items-center gap-2 self-stretch " + (isOpen ? "-mx-2 px-2" : "")}
                  style={isOpen ? { background: vm.circleColor + "40" } : undefined}>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    {isWork
                      ? <span className="truncate italic text-text-secondary">Uncommitted changes · {changes.length} file{changes.length === 1 ? "" : "s"}</span>
                      : <span className={"truncate " + (isOpen || !head || inHead.has(vm.commit.hash) ? "text-text-primary" : "text-text-muted")}>{vm.commit.subject}</span>}
                  </div>
                  {showDate && <span className={"w-20 shrink-0 text-right text-[11px] " + (isOpen ? "text-text-primary" : "text-text-muted")}>{vm.commit.date}</span>}
                  {showSha && <span className={"w-16 shrink-0 text-right font-mono text-[11px] " + (isOpen ? "text-text-primary" : "text-text-muted")}>
                    {copied === vm.commit.hash
                      ? <span className="inline-flex items-center gap-1" style={{ color: "var(--ok, #81b88b)" }}><Check size={10} /> copied</span>
                      : isWork ? "" : vm.commit.hash.slice(0, 7)}
                  </span>}
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ height: (vms.length - last) * RH }} />
        {commits.length >= PAGE && commits.length % PAGE === 0 && (
          <button onClick={loadMore} disabled={more} className="flex h-8 w-full items-center justify-center gap-1 text-xs text-[var(--accent)] hover:underline">
            {more ? <Loader2 size={12} className="animate-spin" /> : null} Load more
          </button>
        )}
      </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.commit)} onClose={() => setMenu(null)} />}
      {branchMenu && (
        <ContextMenu x={branchMenu.x} y={branchMenu.y} alignRight items={branchItems()} onClose={() => setBranchMenu(null)} />
      )}
      {pullMenu && <ContextMenu x={pullMenu.x} y={pullMenu.y} items={pullItems()} onClose={() => setPullMenu(null)} />}
      {drag && (
        <div className="pointer-events-none fixed z-[200] rounded px-1.5 py-0.5 text-[11px] font-medium text-text-primary shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 8, background: "var(--bg-elev)" }}>
          {drag.g.name} → drop on a branch
        </div>
      )}
      {dropMenu && (() => {
        const { from, to } = dropMenu;
        const src = from.local?.label ?? from.remotes[0]?.label ?? from.name;
        const onto = to.local?.label ?? to.remotes[0]?.label ?? to.name;
        const items: MenuEntry[] = [
          ...(to.local ? [{ label: `Merge ${src} into ${to.local.label}`, icon: GitMerge, onClick: () => mergeInto(src, to.local!.label) }] : []),
          ...(from.local ? [{ label: `Rebase ${from.local.label} onto ${onto}`, onClick: () => rebaseOnto(from.local!.label, onto) }] : []),
          { label: `Create ${prNoun} ${from.name} → ${to.name}`, icon: GitPullRequest, onClick: () => setPrFor({ head: from.name, base: to.name }) },
        ];
        return <ContextMenu x={dropMenu.x} y={dropMenu.y} items={items} onClose={() => setDropMenu(null)} />;
      })()}
      {prFor && (
        <PrDialog root={root} head={prFor.head} base={prFor.base} remote={primaryRemote(remotes)}
          onClose={() => setPrFor(null)}
          onDone={(url) => {
            window.dispatchEvent(new CustomEvent(PR_CHANGED, { detail: root })); // this graph's pills and any open list
            if (url) onConfirm?.({
              title: "Pull request created", confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {},
              body: <button onClick={() => void openExternal(url)} className="break-all text-left text-[var(--accent)] hover:underline">{url}</button>,
            });
          }}
          onFail={(title, e) => onConfirm?.({
            title, confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {},
            body: <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px]">{String(e).replace(/^Error:\s*/, "")}</pre>,
          })} />
      )}
      {stashMenu && <ContextMenu x={stashMenu.x} y={stashMenu.y} items={stashItems()} onClose={() => setStashMenu(null)} />}
      {moreMenu && (
        <ContextMenu x={moreMenu.x} y={moreMenu.y} onClose={() => setMoreMenu(null)}
          items={moreMenu.groups.map((g) => {
            const p = g.local ?? g.remotes[0] ?? g.tag ?? g.other;
            return { label: g.name, icon: g.tag && !isBranch(g) ? Tag : GitBranch,
              children: p && p.kind !== "head" && p.kind !== "stash" ? refItems(p) : [{ label: "Nothing to do with this ref", disabled: true }] };
          })} />
      )}
      {refMenu && (
        <ContextMenu x={refMenu.x} y={refMenu.y} items={refItems(refMenu.ref)} onClose={() => setRefMenu(null)} />
      )}
      {naming && (
        <NamePrompt state={naming} onClose={() => setNaming(null)} />
      )}
    </div>
  );
}
