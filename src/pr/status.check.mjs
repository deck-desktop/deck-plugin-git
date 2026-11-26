// node src/pr/status.check.mjs
//
// What the pull request views say (status.ts): the list's groups (each row in one, bots apart,
// search), a row's state, the "before it can merge" rows for GitHub and GitLab (an answer still
// being worked out never shown as fine), the reviewers, and the header's one action.
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = await build({ entryPoints: [new URL("./status.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")], bundle: true, format: "esm", write: false, platform: "node" });
const S = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const row = (n, over = {}) => ({ number: n, url: "", title: `PR ${n}`, isDraft: false, state: "none", review: "", head: `b${n}`, base: "main", author: "maya", updatedAt: "", ...over });

// Bots.
for (const a of ["renovate-bot", "renovate[bot]", "dependabot", "github-actions[bot]", "ci_bot", "Renovate"]) assert.ok(S.isBot(a), a);
for (const a of ["maya", "robert", "abbott", "botanist"]) assert.ok(!S.isBot(a), a);

// Groups: one row in one group only, waiting before yours before bots before the rest.
const all = [row(1), row(2), row(3, { author: "renovate-bot" }), row(4), row(5, { author: "you" })];
const g = S.groupRows(all, [row(1), row(5)], [row(5), row(2)]);
assert.deepEqual([g.waiting, g.yours, g.bots, g.others].map((x) => x.map((r) => r.number)), [[1, 5], [2], [3], [4]]);
// A host that could not say what waits for you, or what is yours: those rows fall through.
const g2 = S.groupRows(all, null, null);
assert.deepEqual([g2.waiting.length, g2.yours.length, g2.bots.length, g2.others.length], [0, 0, 1, 4]);
// A row only the review call returned still shows, once.
assert.deepEqual(S.groupRows([row(1)], [row(9)], null).waiting.map((r) => r.number), [9]);
// Search: title, number (with or without its sign), author, branch.
assert.deepEqual(S.groupRows(all, null, null, "!4").others.map((r) => r.number), [4]);
assert.deepEqual(S.groupRows(all, null, null, "RENOVATE").bots.map((r) => r.number), [3]);
assert.equal(S.groupRows(all, null, null, "nothing like it").others.length, 0);

// A row's state.
assert.equal(S.rowStatus(row(1, { isDraft: true, state: "failing" })).label, "Draft");
assert.deepEqual(S.rowStatus(row(1, { review: "CHANGES_REQUESTED", state: "failing" })), { label: "changes asked", tone: "bad" });
assert.equal(S.rowStatus(row(1, { state: "pending" })).tone, "wait");
assert.equal(S.rowStatus(row(1, { state: "passing", review: "APPROVED" })).label, "approved");
assert.equal(S.rowStatus(row(1, { state: "passing" })), null);

// One pull request.
const detail = (over = {}) => ({
  number: 7, title: "t", body: "", url: "", state: "OPEN", isDraft: false, author: "maya", head: "f", base: "main", headOid: "", baseOid: "",
  mergeable: "MERGEABLE", mergeState: "CLEAN", review: "", checks: [], timeline: [], commits: [], requested: [], labels: [],
  additions: 1, deletions: 1, changedFiles: 1, ...over,
});
const value = (rows, label) => rows.find((r) => r.label === label);

// GitHub: still computing is not "none".
assert.deepEqual(value(S.readiness(detail({ mergeable: "UNKNOWN", mergeState: "UNKNOWN" })), "Conflicts"), { label: "Conflicts", value: "being checked", tone: "muted" });
assert.equal(value(S.readiness(detail({ mergeable: "CONFLICTING" })), "Conflicts").tone, "bad");
assert.equal(value(S.readiness(detail()), "Conflicts").value, "none");
assert.deepEqual(value(S.readiness(detail({ checks: [{ state: "passing" }, { state: "pending" }, { state: "passing" }] })), "Checks"), { label: "Checks", value: "1 running", tone: "wait" });
assert.equal(value(S.readiness(detail({ checks: [{ state: "failing" }, { state: "pending" }] })), "Checks").value, "1 failed");
assert.equal(value(S.readiness(detail()), "Checks").tone, "muted");
assert.deepEqual(value(S.readiness(detail({ review: "REVIEW_REQUIRED", requested: ["omar"] })), "Review"), { label: "Review", value: "waiting on omar", tone: "wait" });
assert.equal(value(S.readiness(detail({ isDraft: true })), "Draft").tone, "wait");
assert.equal(value(S.readiness(detail()), "Draft"), undefined);

// GitLab: its own status in mergeState, blocker set; "checking" is not fine.
const gl = (status, over = {}) => detail({ mergeable: "", mergeState: status, blocker: null, ...over });
assert.equal(value(S.readiness(gl("checking")), "Conflicts").value, "being checked");
assert.equal(value(S.readiness(gl("conflict", { blocker: "Conflicts with main." })), "Conflicts").tone, "bad");
assert.equal(value(S.readiness(gl("need_rebase", { blocker: "Needs a rebase" })), "Conflicts").tone, "bad");
assert.equal(value(S.readiness(gl("mergeable")), "Conflicts").value, "none");
assert.equal(value(S.readiness(gl("not_approved", { blocker: "Needs approval first." })), "Review").value, "needed");

// Reviewers: the last verdict of each, then whoever is still asked.
assert.deepEqual(S.reviewers(detail({
  requested: ["lina", "omar"],
  timeline: [
    { kind: "review", author: "omar", body: "", at: "1", verdict: "CHANGES_REQUESTED" },
    { kind: "review", author: "omar", body: "", at: "2", verdict: "APPROVED" },
    { kind: "comment", author: "sam", body: "hi", at: "3" },
    { kind: "review", author: "maya", body: "", at: "4", verdict: "COMMENTED" },
  ],
})).map((r) => `${r.name}:${r.verdict}`), ["omar:approved", "lina:waiting"]);

// The header's one action.
assert.equal(S.primaryAction(detail(), undefined), null, "nothing until the verdicts are known");
assert.equal(S.primaryAction(detail({ state: "MERGED" }), true), null);
assert.equal(S.primaryAction(detail({ state: "CLOSED" }), true), "reopen");
assert.equal(S.primaryAction(detail({ isDraft: true }), true), "ready");
assert.equal(S.primaryAction(detail({ review: "REVIEW_REQUIRED" }), true), "approve");
assert.equal(S.primaryAction(detail({ review: "REVIEW_REQUIRED", mergeState: "BLOCKED" }), false), "blocked", "your own: its blocker is not yours to lift");
assert.equal(S.primaryAction(detail({ requested: ["you"] }), true), "approve");
assert.equal(S.primaryAction(detail(), true), "merge", "no review wanted: merge");
assert.equal(S.primaryAction(detail({ review: "APPROVED", mergeable: "CONFLICTING" }), true), "blocked");
assert.equal(S.primaryAction(gl("not_approved", { blocker: "Needs approval first.", approvedByMe: false }), true), "approve");
assert.equal(S.primaryAction(gl("not_approved", { blocker: "Needs approval first.", approvedByMe: true }), true), "blocked");

console.log("pr status: ok");
