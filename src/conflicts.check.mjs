// node src/conflicts.check.mjs: merge conflict blocks and resolving one, compiled from the real source.
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = new URL("./conflicts.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node" });
const c = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const resolve = (text, pick) => {
  const lines = text.split("\n");
  return c.resolveBlock(lines, c.findConflicts(lines)[0], pick).join("\n");
};

const two = "top\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> dev\nbottom\n";
assert.deepEqual(c.findConflicts(two.split("\n")), [{ start: 2, base: null, mid: 4, end: 6, current: "HEAD", incoming: "dev" }]);
assert.equal(resolve(two, "current"), "top\nmine\nbottom\n");
assert.equal(resolve(two, "incoming"), "top\ntheirs\nbottom\n");
assert.equal(resolve(two, "both"), "top\nmine\ntheirs\nbottom\n");

// diff3: the base is in neither side.
const diff3 = "<<<<<<< HEAD\na\n||||||| base\nold\n=======\nb\n>>>>>>> dev";
assert.deepEqual(c.sides(diff3.split("\n"), c.findConflicts(diff3.split("\n"))[0]), { current: ["a"], incoming: ["b"] });
assert.equal(resolve(diff3, "both"), "a\nb");

// An empty side, and a block that ends the file without a line ending.
assert.equal(resolve("x\n<<<<<<< HEAD\n=======\ngone\n>>>>>>> dev\ny\n", "current"), "x\ny\n");
assert.equal(resolve("x\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> dev", "incoming"), "x\ntheirs");

// CRLF text split on \n alone keeps \r on each line: still found.
assert.equal(c.findConflicts(two.replace(/\n/g, "\r\n").split("\n")).length, 1);

// Only complete blocks; lookalikes are not markers; a heading underline outside a block is nothing.
const many = ["<<<<<<< HEAD", "1", "=======", "2", ">>>>>>> dev", "<<<<<<<< eight", "=======", ">>>>>>>",
  "<<<<<<< HEAD", "unclosed", "<<<<<<< HEAD", "3", "=======", "4", ">>>>>>> dev", "Title", "======="];
assert.deepEqual(c.findConflicts(many).map((b) => [b.start, b.end]), [[1, 5], [11, 15]]);

console.log("conflicts.check.mjs: all assertions passed");
