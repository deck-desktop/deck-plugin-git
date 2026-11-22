// node src/refs.check.mjs: what a decoration ref is, compiled from the real source.
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = new URL("./refs.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node" });
const o = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

// With the remotes known, a local branch with a slash is local, and a remote's copy is the remote's.
assert.equal(o.parseRef("feature/priorities", ["origin"]).kind, "local");
assert.equal(o.parseRef("origin/feature/priorities", ["origin"]).kind, "remote");
assert.equal(o.parseRef("feature/x", []).kind, "local", "a repo with no remotes has no remote refs");
// Before they are known, a slash is the guess, as before.
assert.equal(o.parseRef("origin/main").kind, "remote");
// Grouped: the local branch and origin's copy are one pill, with the laptop and the cloud.
const [g] = o.groupRefs(["feature/x", "origin/feature/x"], ["origin"]);
assert.equal(g.name, "feature/x"); assert.ok(g.local); assert.equal(g.remotes.length, 1);

console.log("refs.check.mjs: all assertions passed");
