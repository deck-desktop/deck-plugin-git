// node src/repoorder.check.mjs: the repository tabs' order, compiled from the real source.
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = new URL("./repoorder.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node" });
const o = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const git = ["a", "b", "c", "d"];
assert.deepEqual(o.inOrder(git, undefined), git, "nothing saved: git's order");
assert.deepEqual(o.inOrder(git, ["c", "a"]), ["c", "a", "b", "d"], "saved first, the rest after in git's order");
assert.deepEqual(o.inOrder(["a", "b"], ["gone", "b"]), ["b", "a"], "a saved repo that is gone does not matter");

assert.deepEqual(o.moved(git, "a", "c"), ["b", "c", "a", "d"], "dragged right lands in its place");
assert.deepEqual(o.moved(git, "d", "b"), ["a", "d", "b", "c"], "dragged left lands in its place");
assert.deepEqual(o.moved(git, "a", "d"), ["b", "c", "d", "a"], "to the end");
assert.deepEqual(o.moved(git, "d", "a"), ["d", "a", "b", "c"], "to the start");

console.log("repoorder.check.mjs: all assertions passed");
