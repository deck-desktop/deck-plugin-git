// node src/conflicts.check.mjs: finding merge conflict blocks, and each side's file, compiled from the real source.
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = new URL("./conflicts.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node" });
const c = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const two = "top\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> dev\nbottom\n";
assert.deepEqual(c.findConflicts(two.split("\n")), [{ start: 2, base: null, mid: 4, end: 6, current: "HEAD", incoming: "dev" }]);

// diff3: the base marker is recorded.
const diff3 = "<<<<<<< HEAD\na\n||||||| base\nold\n=======\nb\n>>>>>>> dev";
assert.deepEqual(c.findConflicts(diff3.split("\n")), [{ start: 1, base: 3, mid: 5, end: 7, current: "HEAD", incoming: "dev" }]);

// CRLF text split on \n alone keeps \r on each line: still found.
assert.equal(c.findConflicts(two.replace(/\n/g, "\r\n").split("\n")).length, 1);

// Only complete blocks; lookalikes are not markers; a heading underline outside a block is nothing.
const many = ["<<<<<<< HEAD", "1", "=======", "2", ">>>>>>> dev", "<<<<<<<< eight", "=======", ">>>>>>>",
  "<<<<<<< HEAD", "unclosed", "<<<<<<< HEAD", "3", "=======", "4", ">>>>>>> dev", "Title", "======="];
assert.deepEqual(c.findConflicts(many).map((b) => [b.start, b.end]), [[1, 5], [11, 15]]);

// Each side's whole file: blocks replaced, the rest kept, a diff3 base in neither, an empty side.
const file = "top\n<<<<<<< HEAD\nmine\n||||||| base\nold\n=======\ntheirs\nmore\n>>>>>>> dev\nmid\n<<<<<<< HEAD\n=======\ngone\n>>>>>>> dev\nend";
assert.equal(c.sideOf(file.split("\n"), "current").join("\n"), "top\nmine\nmid\nend");
assert.equal(c.sideOf(file.split("\n"), "incoming").join("\n"), "top\ntheirs\nmore\nmid\ngone\nend");
assert.equal(c.sideOf(["no", "markers"], "current").join("\n"), "no\nmarkers");

console.log("conflicts.check.mjs: all assertions passed");
