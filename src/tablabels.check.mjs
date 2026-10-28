// node src/tablabels.check.mjs: what the repository tabs say, compiled from the real source.
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = new URL("./tablabels.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node" });
const { tabLabels } = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const root = String.raw`D:\work`;
const say = (repos) => tabLabels(repos.map((r) => `${root}\\${r}`)).map((l) => (l.parent ? `${l.parent}/` : "") + l.name);

assert.deepEqual(say(["api", "mobile"]), ["api", "mobile"], "unique names stand alone");
assert.deepEqual(say(["packages\\image_editor\\example", "tools\\example", "api"]),
  ["image_editor/example", "tools/example", "api"], "one parent tells two examples apart");
assert.deepEqual(say(["a\\x\\example", "b\\x\\example"]), ["a/x/example", "b/x/example"], "as many parents as it takes");
assert.deepEqual(say(["Example", "tools\\example"]), ["work/Example", "tools/example"], "names compare without case");
assert.deepEqual(tabLabels(["D:/work/app/"]), [{ parent: "", name: "app" }], "a trailing slash is not a folder");

console.log("tablabels.check.mjs: all assertions passed");
