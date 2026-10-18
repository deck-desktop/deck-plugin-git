// The Git plugin's operations, each a git command built here and run through Deck's generic
// gitRun (git -C <dir> <args>; never prompts for credentials; rejects with git's own message).
// These were ~40 Rust commands, one per operation, that only this plugin called.
//
// What stays in Deck: the reads Deck's own Editor shares (gitStatus, gitRefs, gitCheckout…), the
// ones whose parsing or binary output belongs in Rust (gitLogGraph, gitCommitFiles, gitFileBytes),
// gitDiscard (it deletes files), the AI commit message, and the gh/glab calls, whose allowlists
// are their security boundary.
import { fsList, fsWrite, gitRun } from "../shim/bridge.js";

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
/** True when the command exits 0. A non-zero exit is an answer here, not a failure. */
const succeeds = (dir: string, args: string[]) => gitRun(dir, args).then(() => true, () => false);

// ---- the working tree ------------------------------------------------------------------------

/** Stage paths, or everything when none are given. */
export const gitStage = (dir: string, paths: string[]) =>
  gitRun(dir, paths.length ? ["add", "--", ...paths] : ["add", "-A"]).then(() => undefined);
/**
 * Unstage paths, or everything when none are given. A repo with no commit yet has no HEAD to
 * restore from (`restore --staged` and `reset` both fail with "could not resolve HEAD"), so there
 * unstaging takes the paths out of the index, which leaves the files on disk untracked.
 */
export async function gitUnstage(dir: string, paths: string[]): Promise<void> {
  const head = await gitRun(dir, ["rev-parse", "--verify", "-q", "HEAD"]).then(() => true, () => false);
  if (!head) await gitRun(dir, ["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ...(paths.length ? paths : ["."])]);
  else await gitRun(dir, paths.length ? ["restore", "--staged", "--", ...paths] : ["reset", "-q", "HEAD", "--"]);
}

/**
 * Put `content` in the index as `rel`'s staged text, leaving the file on disk alone: how one change
 * is staged or unstaged from a diff. The text goes through a file in the repository's git folder
 * (where nothing reads it as part of the project) into `git hash-object`, with `rel`'s own
 * attributes so line endings are cleaned as `git add` would, and the index entry keeps its mode.
 */
export async function gitSetIndexContent(dir: string, rel: string, content: string): Promise<void> {
  const gitDir = (await gitRun(dir, ["rev-parse", "--absolute-git-dir"])).trim();
  const blob = `${gitDir}/deck-index-blob`;
  await fsWrite(blob, content);
  const sha = (await gitRun(dir, ["hash-object", "-w", `--path=${rel}`, "--", blob])).trim();
  const mode = (await gitRun(dir, ["ls-files", "-s", "--", rel])).trim().split(/\s+/)[0] || "100644";
  await gitRun(dir, ["update-index", "--add", "--cacheinfo", `${mode},${sha},${rel}`]);
}

/** Smart commit (VS Code's default): commit what is staged; with nothing staged, stage all first. */
export async function gitCommit(dir: string, message: string): Promise<string> {
  if (!message.trim()) throw "empty commit message";
  // `diff --cached --quiet` exits 0 when nothing is staged.
  if (await succeeds(dir, ["diff", "--cached", "--quiet"])) await gitRun(dir, ["add", "-A"]);
  return gitRun(dir, ["commit", "-m", message]);
}
/** Amend the last commit: its message as is when `message` is blank. */
export const gitCommitAmend = (dir: string, message: string) =>
  gitRun(dir, message.trim() ? ["commit", "--amend", "-m", message] : ["commit", "--amend", "--no-edit"]);
/** Undo the last commit, keeping its changes staged. */
export const gitUndoCommit = (dir: string) => gitRun(dir, ["reset", "--soft", "HEAD~1"]);

// ---- remotes ---------------------------------------------------------------------------------

export const gitPush = (dir: string) => gitRun(dir, ["push"]);
export const gitPull = (dir: string) => gitRun(dir, ["pull", "--ff-only"]);
export const gitPullRebase = (dir: string) => gitRun(dir, ["pull", "--rebase"]);
export const gitFetch = (dir: string) => gitRun(dir, ["fetch", "--prune"]);
export const gitPushBranch = (dir: string, remote: string, name: string) => gitRun(dir, ["push", "-u", remote, name]);
export const gitRemotes = (dir: string) => gitRun(dir, ["remote"]).then(lines, () => [] as string[]);
export const gitRemoteUrl = (dir: string, name: string) => gitRun(dir, ["remote", "get-url", name]).then((s) => s.trim());
/** Fetch pull request N's head from `remote`, so its commits can be diffed here. `gitlab`: a merge request's. */
export const gitFetchPr = (dir: string, remote: string, number: number, base: string, gitlab = false) =>
  gitRun(dir, ["fetch", remote, gitlab ? `merge-requests/${number}/head` : `pull/${number}/head`, base]);

// ---- commits ---------------------------------------------------------------------------------

/** HEAD's commit and branch ("" when detached): what an undo returns to. */
export async function gitHead(dir: string): Promise<{ hash: string; branch: string }> {
  const hash = (await gitRun(dir, ["rev-parse", "HEAD"])).trim();
  const branch = await gitRun(dir, ["symbolic-ref", "--short", "-q", "HEAD"]).then((s) => s.trim(), () => "");
  return { hash, branch };
}
export const gitBranchAt = (dir: string, name: string, rev: string) => gitRun(dir, ["checkout", "-b", name, rev]);
/** Revert a commit; a merge is reverted against its first parent. */
export async function gitRevert(dir: string, rev: string): Promise<string> {
  const parents = (await gitRun(dir, ["rev-list", "--parents", "-n", "1", rev])).trim().split(/\s+/);
  return gitRun(dir, parents.length > 2 ? ["revert", "--no-edit", "-m", "1", rev] : ["revert", "--no-edit", rev]);
}
export const gitCherryPick = (dir: string, rev: string) => gitRun(dir, ["cherry-pick", rev]);
export const gitResetTo = (dir: string, rev: string, mode: "soft" | "mixed" | "hard" | "keep") =>
  gitRun(dir, ["reset", `--${mode}`, rev]);
export const gitRebase = (dir: string, onto: string) => gitRun(dir, ["rebase", onto]);
/** Merge `rev` into the current branch: a merge commit always, fast-forward when possible, or squashed into one commit. */
export async function gitMergeAs(dir: string, rev: string, style: "no-ff" | "ff" | "squash"): Promise<string> {
  if (style === "squash") {
    await gitRun(dir, ["merge", "--squash", rev]);
    return gitRun(dir, ["commit", "--no-edit"]);
  }
  return gitRun(dir, style === "ff" ? ["merge", "--no-edit", rev] : ["merge", "--no-ff", "--no-edit", rev]);
}
/** Subjects of the commits on `head` that `base` lacks, oldest first. */
export const gitRangeSubjects = (dir: string, base: string, head: string) =>
  gitRun(dir, ["log", "--reverse", "--format=%s", `${base}..${head}`]).then((s) => s.split(/\r?\n/).filter(Boolean), () => [] as string[]);
export const gitMergeBase = (dir: string, a: string, b: string) => gitRun(dir, ["merge-base", a, b]).then((s) => s.trim());

// ---- an operation that stopped half way --------------------------------------------------------

/**
 * "" when the repo is idle, else "merge" | "revert" | "cherry-pick" | "rebase": the operation it
 * stopped in. Read from the repo's own git folder, found by git, so it is right from a subfolder,
 * a worktree or a submodule too (`<dir>\.git` is none of those).
 */
export async function gitPendingOp(dir: string): Promise<string> {
  const gitDir = (await gitRun(dir, ["rev-parse", "--absolute-git-dir"]).catch(() => "")).trim();
  if (!gitDir) return "";
  const names = new Set((await fsList(gitDir).catch(() => [])).map((e) => e.name));
  for (const [file, op] of [["MERGE_HEAD", "merge"], ["REVERT_HEAD", "revert"], ["CHERRY_PICK_HEAD", "cherry-pick"],
                             ["rebase-merge", "rebase"], ["rebase-apply", "rebase"]] as const) {
    if (names.has(file)) return op;
  }
  return "";
}
/** Finish what gitPendingOp reported, once its conflicts are resolved and staged. */
export const gitContinueOp = (dir: string, op: string) =>
  gitRun(dir, ["rebase", "revert", "cherry-pick"].includes(op)
    // No editor: git would otherwise wait on one for the message, with no window to show it in.
    ? ["-c", "core.editor=true", op, "--continue"]
    : ["commit", "--no-edit"]);
/** Abandon it, restoring the state before it started. */
export const gitAbortOp = (dir: string, op: string) =>
  gitRun(dir, [["revert", "cherry-pick", "rebase"].includes(op) ? op : "merge", "--abort"]);

// ---- branches and tags -----------------------------------------------------------------------

export const gitBranchRename = (dir: string, from: string, to: string) => gitRun(dir, ["branch", "-m", from, to]);
export const gitBranchDelete = (dir: string, name: string, force = false) => gitRun(dir, ["branch", force ? "-D" : "-d", name]);
export const gitBranchDeleteRemote = (dir: string, remote: string, name: string) => gitRun(dir, ["push", remote, "--delete", name]);
/** A lightweight tag, or an annotated one when there is a message. */
export const gitTag = (dir: string, name: string, rev: string, message = "") =>
  gitRun(dir, message.trim() ? ["tag", "-a", name, rev, "-m", message] : ["tag", name, rev]);
export const gitTagDelete = (dir: string, name: string) => gitRun(dir, ["tag", "-d", name]);
export const gitTagPush = (dir: string, remote: string, name: string) => gitRun(dir, ["push", remote, name]);
export const gitTagDeleteRemote = (dir: string, remote: string, name: string) => gitRun(dir, ["push", remote, "--delete", `refs/tags/${name}`]);

// ---- the stash -------------------------------------------------------------------------------

/** Stash changes: everything tracked, untracked files too, or only what is staged. */
export function gitStash(dir: string, kind: "" | "untracked" | "staged" = "", message = ""): Promise<string> {
  const args = ["stash", "push"];
  if (kind === "untracked") args.push("-u");
  if (kind === "staged") args.push("-S");
  if (message.trim()) args.push("-m", message);
  return gitRun(dir, args);
}
const stashRef = (index?: number) => (index === undefined ? [] : [`stash@{${index}}`]);
export const gitStashApply = (dir: string, index?: number) => gitRun(dir, ["stash", "apply", ...stashRef(index)]);
export const gitStashPop = (dir: string, index?: number) => gitRun(dir, ["stash", "pop", ...stashRef(index)]);
export const gitStashDrop = (dir: string, index?: number) => gitRun(dir, ["stash", "drop", ...stashRef(index)]);
export const gitStashClear = (dir: string) => gitRun(dir, ["stash", "clear"]);
