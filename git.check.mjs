// node git.check.mjs — the Git plugin's operations (src/git.ts) against real git.
//
// git.ts builds each operation's git command and runs it through Deck's gitRun. Here gitRun is a
// stand-in with the same contract as the Rust command (git -C <dir> <args>; stdout, or stderr and
// stdout as the error), so what is checked is the commands git.ts builds, in a scratch repo.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

globalThis.__gitRun = async (dir, args) => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  } catch (e) {
    throw [e.stderr, e.stdout].map((x) => String(x ?? "").trim()).filter(Boolean).join("\n") || `git exited with ${e.status}`;
  }
};
globalThis.__fsList = async (dir) => readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, path: join(dir, d.name), dir: d.isDirectory(), mtimeMs: 0 }));
const shim = { name: "shim", setup(b) {
  b.onResolve({ filter: /shim\/bridge\.js$/ }, () => ({ path: "shim", namespace: "shim" }));
  b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({ contents: "export const gitRun = (...a) => globalThis.__gitRun(...a); export const fsList = (...a) => globalThis.__fsList(...a);" }));
} };
const entry = new URL("./src/git.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", plugins: [shim] });
const g = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const dir = mkdtempSync(join(tmpdir(), "deck-git-"));
const sh = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const write = (f, t) => writeFileSync(join(dir, f), t);
try {
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "t"); sh("config", "user.email", "t@t"); sh("config", "core.autocrlf", "false");

  // Smart commit: nothing staged, so it stages everything first. A blank message is refused.
  write("a.txt", "one\n");
  await assert.rejects(g.gitCommit(dir, "  "), /empty commit message/);
  await g.gitCommit(dir, "first");
  assert.equal(sh("log", "--format=%s"), "first");
  // Something staged: only that is committed.
  write("a.txt", "two\n"); write("b.txt", "b\n");
  await g.gitStage(dir, ["b.txt"]);
  await g.gitCommit(dir, "add b");
  assert.equal(sh("show", "--name-only", "--format="), "b.txt");
  await g.gitStage(dir, []);
  await g.gitUnstage(dir, ["a.txt"]);
  assert.equal(sh("diff", "--cached", "--name-only"), "");
  await g.gitCommitAmend(dir, "add b, amended");
  assert.equal(sh("log", "-1", "--format=%s"), "add b, amended");
  await g.gitCommitAmend(dir, "");
  assert.equal(sh("log", "-1", "--format=%s"), "add b, amended", "a blank amend keeps the message");

  // HEAD, branches, tags.
  const head = await g.gitHead(dir);
  assert.equal(head.branch, "main"); assert.match(head.hash, /^[0-9a-f]{40}$/);
  await g.gitBranchAt(dir, "feature", "HEAD~1");
  assert.equal((await g.gitHead(dir)).branch, "feature");
  await g.gitBranchRename(dir, "feature", "feat");
  await g.gitTag(dir, "v1", "HEAD");
  await g.gitTag(dir, "v2", "HEAD", "annotated");
  assert.equal(sh("cat-file", "-t", "v2"), "tag"); assert.equal(sh("cat-file", "-t", "v1"), "commit");
  await g.gitTagDelete(dir, "v1");
  assert.deepEqual(await g.gitRemotes(dir), []);
  sh("checkout", "-q", "main");
  await g.gitBranchDelete(dir, "feat", true);
  assert.equal(sh("branch", "--list", "feat"), "");

  // The stash.
  write("a.txt", "stashed\n");
  await g.gitStash(dir, "", "wip");
  assert.match(sh("stash", "list"), /wip/);
  await g.gitStashPop(dir, 0);
  assert.equal(sh("stash", "list"), "");
  await g.gitStash(dir); await g.gitStashDrop(dir); await g.gitStashClear(dir);
  sh("checkout", "--", ".");

  // A conflicting merge: the error carries git's CONFLICT line, the repo reports "merge", and
  // abort puts it back.
  sh("checkout", "-q", "-b", "other");
  write("a.txt", "theirs\n"); sh("commit", "-qam", "theirs");
  sh("checkout", "-q", "main");
  write("a.txt", "ours\n"); sh("commit", "-qam", "ours");
  await assert.rejects(g.gitMergeAs(dir, "other", "no-ff"), /CONFLICT/);
  assert.equal(await g.gitPendingOp(dir), "merge");
  await g.gitAbortOp(dir, "merge");
  assert.equal(await g.gitPendingOp(dir), "");
  // Resolved and continued.
  await g.gitMergeAs(dir, "other", "no-ff").catch(() => {});
  write("a.txt", "both\n"); sh("add", "a.txt");
  await g.gitContinueOp(dir, "merge");
  assert.equal(await g.gitPendingOp(dir), "");
  assert.equal(sh("rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3, "a merge commit");
  // Reverting a merge picks its first parent.
  await g.gitRevert(dir, "HEAD");
  assert.match(sh("log", "-1", "--format=%s"), /^Revert/);

  // A squash merge is one commit with the branch's changes.
  sh("checkout", "-q", "-b", "sq"); write("c.txt", "c\n"); sh("add", "c.txt"); sh("commit", "-qm", "c");
  sh("checkout", "-q", "main");
  await g.gitMergeAs(dir, "sq", "squash");
  assert.equal(sh("show", "--name-only", "--format="), "c.txt");
  assert.equal(sh("rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 2, "not a merge commit");

  // Ranges and reset.
  assert.deepEqual(await g.gitRangeSubjects(dir, "main~1", "main"), [sh("log", "-1", "--format=%s")]);
  assert.match(await g.gitMergeBase(dir, "main", "sq"), /^[0-9a-f]{40}$/);
  await g.gitUndoCommit(dir);
  assert.equal(sh("diff", "--cached", "--name-only"), "c.txt", "undo keeps the changes staged");
  await g.gitResetTo(dir, "HEAD", "hard");
  assert.equal(sh("status", "--porcelain"), "");
  // A stopped cherry-pick, seen from a subfolder: the old check read <dir>\.git, which a
  // subfolder does not have; git.ts asks git where the repo's folder is.
  sh("checkout", "-q", "other");
  execFileSync("git", ["-C", dir, "config", "advice.mergeConflict", "false"]);
  await assert.rejects(g.gitCherryPick(dir, "main~2"), /CONFLICT|conflict/);
  execFileSync("git", ["-C", dir, "status"]); // the repo really is mid cherry-pick
  const sub = join(dir, "sub"); execFileSync(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(sub)})`]);
  assert.equal(await g.gitPendingOp(sub), "cherry-pick");
  await g.gitAbortOp(sub, "cherry-pick");
  assert.equal(await g.gitPendingOp(dir), "");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("git.check.mjs: ok");
