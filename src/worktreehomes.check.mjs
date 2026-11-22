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

console.log("worktreehomes.check.mjs: all assertions passed");
