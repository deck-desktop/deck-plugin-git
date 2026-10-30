// The Git plugin's operations, each a git command built here and run through Deck's generic
// gitRun (git -C <dir> <args>; never prompts for credentials; rejects with git's own message).
// These were ~40 Rust commands, one per operation, that only this plugin called.
//
// What stays in Deck: the reads Deck's own Editor shares (gitStatus, gitRefs, gitCheckout…), the
// ones whose parsing or binary output belongs in Rust (gitLogGraph, gitCommitFiles, gitFileBytes),
// gitDiscard (it deletes files), the AI commit message, and the gh/glab calls, whose allowlists
// are their security boundary.
//
// Each action that changes the repository says so in a notification once it is done (notice.ts);
// staging, a read and the refresh button's fetch do not, being too frequent to be news.
import {
  fsList, fsWrite, gitRun, gitCheckout as deckCheckout, gitCheckoutNew as deckCheckoutNew, gitCheckoutTrack as deckCheckoutTrack,
  gitCheckoutDetach as deckCheckoutDetach, gitDiscard as deckDiscard,
} from "../shim/bridge.js";
import { repoName, short, told } from "./notice";
import { primaryRemote } from "./prs";

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
/** The branch checked out, "" when HEAD is detached. */
const branchOf = (dir: string) => gitRun(dir, ["symbolic-ref", "--short", "-q", "HEAD"]).then((s) => s.trim(), () => "");
/** A done notification about `dir`: what happened, the repository it happened in. */
const said = (dir: string, title: string, more = "") => ({ title, body: more ? `${repoName(dir)}: ${more}` : repoName(dir) });
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

/**
 * Smart commit (VS Code's default): commit what is staged; with nothing staged, stage all first.
 * Never stages all while a conflict is unresolved, which would stage its markers: git then refuses
 * the commit and says why. Refused too while staged lines still hold conflict markers.
 */
export async function gitCommit(dir: string, message: string): Promise<string> {
  if (!message.trim()) throw "empty commit message";
  const unmerged = (await gitRun(dir, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")).trim();
  // `diff --cached --quiet` exits 0 when nothing is staged.
  if (!unmerged && await succeeds(dir, ["diff", "--cached", "--quiet"])) await gitRun(dir, ["add", "-A"]);
  await noLeftoverMarkers(dir);
  const branch = await branchOf(dir);
  return told(() => gitRun(dir, ["commit", "-m", message]), () => said(dir, branch ? `Committed to ${branch}` : "Committed", message.trim().split(/\r?\n/)[0]));
}
/** Amend the last commit: its message as is when `message` is blank. */
export const gitCommitAmend = (dir: string, message: string) =>
  told(() => gitRun(dir, message.trim() ? ["commit", "--amend", "-m", message] : ["commit", "--amend", "--no-edit"]), () => said(dir, "Amended the last commit"));
/** Undo the last commit, keeping its changes staged. */
export const gitUndoCommit = (dir: string) =>
  told(() => gitRun(dir, ["reset", "--soft", "HEAD~1"]), () => said(dir, "Undid the last commit", "its changes are staged"));

// ---- remotes ---------------------------------------------------------------------------------

/** Push the branch checked out. One never pushed gets an upstream set on the primary remote
 *  instead of git's refusal, which is what the push was for. */
export async function gitPush(dir: string): Promise<string> {
  const branch = await branchOf(dir);
  return told(async () => {
    try { return await gitRun(dir, ["push"]); }
    catch (e) {
      if (!branch || !/no upstream/i.test(String(e))) throw e;
      return gitRun(dir, ["push", "-u", primaryRemote(await gitRemotes(dir)), branch]);
    }
  }, () => said(dir, branch ? `Pushed ${branch}` : "Pushed"), said(dir, branch ? `Pushing ${branch}…` : "Pushing…"));
}
/** A pull that brought nothing says so, rather than claiming to have pulled. */
async function pull(dir: string, args: string[]): Promise<string> {
  const branch = await branchOf(dir);
  return told(() => gitRun(dir, args),
    (out) => /up to date/i.test(out) ? said(dir, `${branch || "The branch"} is up to date`) : said(dir, branch ? `Pulled ${branch}` : "Pulled"),
    said(dir, branch ? `Pulling ${branch}…` : "Pulling…"));
}
export const gitPull = (dir: string) => pull(dir, ["pull", "--ff-only"]);
export const gitPullRebase = (dir: string) => pull(dir, ["pull", "--rebase"]);
/** Quiet: the refresh button's, run on every press. */
export const gitFetch = (dir: string) => gitRun(dir, ["fetch", "--prune"]);
export const gitPushBranch = (dir: string, remote: string, name: string) =>
  told(() => gitRun(dir, ["push", "-u", remote, name]), () => said(dir, `Pushed ${name} to ${remote}`), said(dir, `Pushing ${name}…`));
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
export const gitBranchAt = (dir: string, name: string, rev: string) =>
  told(() => gitRun(dir, ["checkout", "-b", name, rev]), () => said(dir, `Created ${name}`, `at ${short(rev)}, checked out`));
/** Revert a commit; a merge is reverted against its first parent. */
export async function gitRevert(dir: string, rev: string): Promise<string> {
  const parents = (await gitRun(dir, ["rev-list", "--parents", "-n", "1", rev])).trim().split(/\s+/);
  return told(() => gitRun(dir, parents.length > 2 ? ["revert", "--no-edit", "-m", "1", rev] : ["revert", "--no-edit", rev]),
    () => said(dir, `Reverted ${short(rev)}`));
}
export const gitCherryPick = (dir: string, rev: string) =>
  told(() => gitRun(dir, ["cherry-pick", rev]), () => said(dir, `Cherry-picked ${short(rev)}`));
export async function gitResetTo(dir: string, rev: string, mode: "soft" | "mixed" | "hard" | "keep"): Promise<string> {
  const branch = await branchOf(dir);
  return told(() => gitRun(dir, ["reset", `--${mode}`, rev]), () => said(dir, `Reset ${branch || "HEAD"} to ${short(rev)}`, `${mode} reset`));
}
export const gitRebase = (dir: string, onto: string) =>
  told(() => gitRun(dir, ["rebase", onto]), () => said(dir, `Rebased onto ${short(onto)}`));
/** Merge `rev` into the current branch: a merge commit always, fast-forward when possible, or squashed into one commit. */
export async function gitMergeAs(dir: string, rev: string, style: "no-ff" | "ff" | "squash"): Promise<string> {
  const into = await branchOf(dir);
  const done = () => said(dir, `${style === "squash" ? "Squashed" : "Merged"} ${short(rev)}${into ? ` into ${into}` : ""}`);
  if (style === "squash") {
    await gitRun(dir, ["merge", "--squash", rev]);
    return told(() => gitRun(dir, ["commit", "--no-edit"]), done);
  }
  return told(() => gitRun(dir, style === "ff" ? ["merge", "--no-edit", rev] : ["merge", "--no-ff", "--no-edit", rev]), done);
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
/**
 * Refuse while staged lines still hold conflict markers. `diff --check` reports them (and
 * whitespace errors, not counted here) and exits non-zero, so its text comes as the error.
 */
async function noLeftoverMarkers(dir: string): Promise<void> {
  const out = await gitRun(dir, ["diff", "--cached", "--check"]).catch((e) => String(e));
  const at = out.split(/\r?\n/).filter((l) => l.endsWith(": leftover conflict marker")).map((l) => l.slice(0, -": leftover conflict marker".length));
  if (at.length) throw `Conflict markers are still in ${at.slice(0, 5).join(", ")}${at.length > 5 ? "…" : ""}. Remove them and stage the file again first.`;
}
/** Resolve conflicted files wholly to one side (ours: this branch; theirs: the one coming in), and stage them. */
export const gitTakeSide = (dir: string, paths: string[], side: "ours" | "theirs") =>
  told(async () => { await gitRun(dir, ["checkout", `--${side}`, "--", ...paths]); await gitRun(dir, ["add", "--", ...paths]); },
    () => said(dir, `Took ${side === "ours" ? "the current change" : "the incoming change"}`, paths.join(", ")));
/** Finish what gitPendingOp reported, once its conflicts are resolved and staged. */
export async function gitContinueOp(dir: string, op: string) {
  await noLeftoverMarkers(dir);
  return told(() => gitRun(dir, ["rebase", "revert", "cherry-pick"].includes(op)
    // No editor: git would otherwise wait on one for the message, with no window to show it in.
    ? ["-c", "core.editor=true", op, "--continue"]
    : ["commit", "--no-edit"]), () => said(dir, `Finished the ${op}`));
}
/** Abandon it, restoring the state before it started. */
export const gitAbortOp = (dir: string, op: string) =>
  told(() => gitRun(dir, [["revert", "cherry-pick", "rebase"].includes(op) ? op : "merge", "--abort"]), () => said(dir, `Abandoned the ${op}`));

// ---- branches and tags -----------------------------------------------------------------------

export const gitBranchRename = (dir: string, from: string, to: string) =>
  told(() => gitRun(dir, ["branch", "-m", from, to]), () => said(dir, `Renamed ${from} to ${to}`));
export const gitBranchDelete = (dir: string, name: string, force = false) =>
  told(() => gitRun(dir, ["branch", force ? "-D" : "-d", name]), () => said(dir, `Deleted ${name}`));
export const gitBranchDeleteRemote = (dir: string, remote: string, name: string) =>
  told(() => gitRun(dir, ["push", remote, "--delete", name]), () => said(dir, `Deleted ${name} from ${remote}`), said(dir, `Deleting ${name} from ${remote}…`));
/** A lightweight tag, or an annotated one when there is a message. */
export const gitTag = (dir: string, name: string, rev: string, message = "") =>
  told(() => gitRun(dir, message.trim() ? ["tag", "-a", name, rev, "-m", message] : ["tag", name, rev]), () => said(dir, `Tagged ${short(rev)} as ${name}`));
export const gitTagDelete = (dir: string, name: string) =>
  told(() => gitRun(dir, ["tag", "-d", name]), () => said(dir, `Deleted tag ${name}`));
export const gitTagPush = (dir: string, remote: string, name: string) =>
  told(() => gitRun(dir, ["push", remote, name]), () => said(dir, `Pushed tag ${name} to ${remote}`), said(dir, `Pushing tag ${name}…`));
export const gitTagDeleteRemote = (dir: string, remote: string, name: string) =>
  told(() => gitRun(dir, ["push", remote, "--delete", `refs/tags/${name}`]), () => said(dir, `Deleted tag ${name} from ${remote}`));

// ---- the stash -------------------------------------------------------------------------------

/** Stash changes: everything tracked, untracked files too, or only what is staged. */
export function gitStash(dir: string, kind: "" | "untracked" | "staged" = "", message = ""): Promise<string> {
  const args = ["stash", "push"];
  if (kind === "untracked") args.push("-u");
  if (kind === "staged") args.push("-S");
  if (message.trim()) args.push("-m", message);
  return told(() => gitRun(dir, args), (out) => /no local changes/i.test(out) ? said(dir, "Nothing to stash") : said(dir, "Stashed the changes", message.trim()));
}
const stashRef = (index?: number) => (index === undefined ? [] : [`stash@{${index}}`]);
const stashName = (index?: number) => (index ? `stash ${index}` : "the stash");
export const gitStashApply = (dir: string, index?: number) =>
  told(() => gitRun(dir, ["stash", "apply", ...stashRef(index)]), () => said(dir, `Applied ${stashName(index)}`));
export const gitStashPop = (dir: string, index?: number) =>
  told(() => gitRun(dir, ["stash", "pop", ...stashRef(index)]), () => said(dir, `Popped ${stashName(index)}`));
export const gitStashDrop = (dir: string, index?: number) =>
  told(() => gitRun(dir, ["stash", "drop", ...stashRef(index)]), () => said(dir, `Dropped ${stashName(index)}`));
export const gitStashClear = (dir: string) => told(() => gitRun(dir, ["stash", "clear"]), () => said(dir, "Cleared every stash"));

// ---- Deck's own commands, shared with the Editor, said here ------------------------------------
//
// Checkout and discard are Deck's (the Editor runs them too), so this plugin's calls go through
// these, which add the notification; the Editor's stay quiet.

export const gitCheckout = (dir: string, name: string) =>
  told(() => deckCheckout(dir, name), () => said(dir, `Checked out ${name}`));
export const gitCheckoutNew = (dir: string, name: string) =>
  told(() => deckCheckoutNew(dir, name), () => said(dir, `Created ${name}`, "checked out"));
/** A remote branch, as a local one tracking it. */
export const gitCheckoutTrack = (dir: string, remote: string) =>
  told(() => deckCheckoutTrack(dir, remote), () => said(dir, `Checked out ${remote.replace(/^[^/]+\//, "")}`, `tracking ${remote}`));
export const gitCheckoutDetach = (dir: string, rev: string) =>
  told(() => deckCheckoutDetach(dir, rev), () => said(dir, `Checked out ${short(rev)}`, "no branch (detached)"));
/** Throw away the changes to these files. */
export const gitDiscard = (dir: string, paths: string[]) =>
  told(() => deckDiscard(dir, paths), () => said(dir, `Discarded ${paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} changes`}`));
