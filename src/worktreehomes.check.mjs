// node src/worktreehomes.check.mjs: the branches checked out in other worktrees, compiled from the real source.
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = new URL("./worktreehomes.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node" });
const o = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const text = [
  "worktree D:/code/deck", "HEAD 1", "branch refs/heads/dev", "",
  "worktree D:/code/deck.fix-login", "HEAD 2", "branch refs/heads/fix/login", "locked", "",
  "worktree D:/code/deck.spike", "HEAD 3", "detached", "",
  "worktree D:/code/gone", "HEAD 4", "branch refs/heads/old", "prunable gitdir file points to non-existent location", "",
].join("\r\n");
assert.deepEqual(o.parseHomes(text), [{ branch: "fix/login", path: "D:/code/deck.fix-login", folder: "deck.fix-login" }],
  "the repo's own checkout, a detached one and a stale one are not homes");
assert.deepEqual(o.parseHomes(""), []);

// A row of uncommitted changes above each busy worktree branch's tip, its parent that tip.
const c = (hash, refs = []) => ({ hash, parents: [], author: "", email: "", date: "", subject: hash, body: "", refs });
const log = [c("a", ["feature/x"]), c("b", ["HEAD -> main"]), c("c", ["feature/y"])];
const homes = new Map([
  ["feature/x", { branch: "feature/x", path: "D:/r.x", folder: "r.x", changed: 2 }],
  ["feature/y", { branch: "feature/y", path: "D:/r.y", folder: "r.y", changed: 0 }],
  ["gone", { branch: "gone", path: "D:/r.g", folder: "r.g", changed: 5 }],
]);
const rows = o.withWorktreeRows(log, homes);
assert.deepEqual(rows.map((r) => r.hash), ["worktree:D:/r.x", "a", "b", "c"], "only a branch with changes, and only one in the log");
assert.deepEqual(rows[0].parents, ["a"]);
assert.equal(rows[0].subject, "Uncommitted changes · 2 files in r.x");
assert.ok(o.isOtherWork(rows[0].hash) && !o.isOtherWork("worktree"));

console.log("worktreehomes.check.mjs: all assertions passed");
