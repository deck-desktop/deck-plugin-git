// Pull-request helpers, checked without the app.
//
//   node src/modules/editor/prs.check.mjs
//
// Compiled from the real source with esbuild, as the other checks are, so it fails when prs.ts
// changes rather than when a copy of it does.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "deck-prs-"));
const out = join(dir, "prs.mjs");
await build({ entryPoints: [join(import.meta.dirname, "prs.ts")], outfile: out, format: "esm", bundle: false });
const { parseRemote, compareUrl, humanizeBranch, draftPr, prState, parsePrList, parsePrRows, parsePrDetail, mergeBlocker, parseThreads, primaryRemote,
  parseMrRows, parseMrDetail, parseMrThreads, mrState, mrBlocker } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

// Every remote spelling resolves to the same web address.
for (const url of [
  "https://github.com/deck-desktop/deck.git",
  "https://github.com/deck-desktop/deck",
  "https://user@github.com/deck-desktop/deck.git",
  "git@github.com:deck-desktop/deck.git",
  "ssh://git@github.com/deck-desktop/deck.git",
]) {
  assert.deepEqual(parseRemote(url), { host: "github", web: "https://github.com/deck-desktop/deck" }, url);
}
assert.equal(parseRemote("git@gitlab.com:group/sub/proj.git").host, "gitlab");
assert.equal(parseRemote("git@gitlab.com:group/sub/proj.git").web, "https://gitlab.com/group/sub/proj");
assert.equal(parseRemote("https://bitbucket.org/team/repo.git").host, "bitbucket");
assert.equal(parseRemote("https://git.example.com/a/b.git").host, "other");
// A self-hosted GitLab, named anything with "gitlab" in it.
assert.deepEqual(parseRemote("https://gitlab-ce.example.dev/group/app.git"), { host: "gitlab", web: "https://gitlab-ce.example.dev/group/app" });
assert.equal(parseRemote("git@gitlab.example.com:g/app.git").host, "gitlab");
assert.equal(parseRemote("not a url"), null);

const gh = parseRemote("git@github.com:o/r.git");
assert.equal(compareUrl(gh, "main", "feat/x"), "https://github.com/o/r/compare/main...feat%2Fx?expand=1");
assert.match(compareUrl(parseRemote("git@gitlab.com:o/r.git"), "main", "f"), /merge_requests\/new\?merge_request\[source_branch\]=f&merge_request\[target_branch\]=main$/);
assert.equal(compareUrl(parseRemote("https://bitbucket.org/o/r"), "main", "f"), "https://bitbucket.org/o/r/pull-requests/new?source=f&dest=main");
assert.equal(compareUrl(parseRemote("https://git.example.com/a/b"), "main", "f"), null);

assert.equal(humanizeBranch("feat/graph-kraken"), "Graph kraken");
assert.equal(humanizeBranch("fix_login"), "Fix login");

// One commit: its subject. Several: the branch. A template beats the commit list.
assert.deepEqual(draftPr("feat/x", ["Add x"], null), { title: "Add x", body: "- Add x" });
assert.deepEqual(draftPr("feat/add-x", ["a", "b"], null), { title: "Add x", body: "- a\n- b" });
assert.equal(draftPr("feat/x", ["a", "b"], "## Summary\n").body, "## Summary\n");
assert.equal(draftPr("feat/x", ["a"], "   ").body, "- a"); // a blank template is no template

// Check rollups: check runs (status + conclusion) and commit statuses (state).
assert.equal(prState([], ""), "none");
assert.equal(prState([], "APPROVED"), "passing");
assert.equal(prState([{ status: "COMPLETED", conclusion: "SUCCESS" }], ""), "passing");
assert.equal(prState([{ status: "IN_PROGRESS", conclusion: null }], ""), "pending");
assert.equal(prState([{ state: "PENDING" }], ""), "pending");
assert.equal(prState([{ state: "SUCCESS" }], ""), "passing");
assert.equal(prState([{ status: "COMPLETED", conclusion: "FAILURE" }, { status: "IN_PROGRESS" }], ""), "failing");
assert.equal(prState([{ status: "COMPLETED", conclusion: "SUCCESS" }], "CHANGES_REQUESTED"), "failing");

const list = parsePrList(JSON.stringify([
  { number: 12, title: "New", url: "u12", headRefName: "feat/a", isDraft: true, reviewDecision: "", statusCheckRollup: [] },
  { number: 9, title: "Old", url: "u9", headRefName: "feat/a", isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [] },
  { number: 7, title: "B", url: "u7", headRefName: "feat/b", isDraft: false, reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] },
]));
assert.equal(list.size, 2);
assert.equal(list.get("feat/a").number, 12); // the first listed per branch
assert.equal(list.get("feat/a").isDraft, true);
assert.equal(list.get("feat/b").state, "passing");
assert.equal(parsePrList("not json").size, 0);

// The list keeps gh's order and reads author logins.
const rows = parsePrRows(JSON.stringify([
  { number: 3, title: "T", url: "u", headRefName: "h", baseRefName: "main", author: { login: "ann" }, isDraft: false,
    reviewDecision: "", statusCheckRollup: [], updatedAt: "2026-10-01T00:00:00Z" },
]));
assert.equal(rows[0].author, "ann");
assert.equal(rows[0].base, "main");

const detail = (over = {}) => parsePrDetail(JSON.stringify({
  number: 5, title: "PR", body: "desc", url: "u", state: "OPEN", isDraft: false, author: { login: "ann" },
  headRefName: "feat/x", baseRefName: "main", headRefOid: "h1", baseRefOid: "b1",
  mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "",
  statusCheckRollup: [{ name: "build", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "d" }, { context: "lint", state: "SUCCESS" }],
  comments: [{ author: { login: "bob" }, body: "first", createdAt: "2026-10-01T10:00:00Z" }],
  reviews: [
    { author: { login: "cy" }, body: "", state: "COMMENTED", submittedAt: "2026-10-01T09:00:00Z" }, // line comments only
    { author: { login: "cy" }, body: "", state: "APPROVED", submittedAt: "2026-10-01T11:00:00Z" },
    { author: { login: "dee" }, body: "nit", state: "COMMENTED", submittedAt: "2026-10-01T08:00:00Z" },
  ],
  commits: [{ oid: "c1", messageHeadline: "do x", authors: [{ login: "ann", name: "Ann" }], committedDate: "2026-09-30T00:00:00Z" }],
  reviewRequests: [{ login: "eve" }, { name: "core-team" }], labels: [{ name: "bug", color: "d73a4a" }],
  additions: 10, deletions: 2, changedFiles: 3, createdAt: "2026-09-30T00:00:00Z", ...over,
}));
const d = detail();
assert.deepEqual(d.checks.map((c) => [c.name, c.state]), [["build", "failing"], ["lint", "passing"]]);
// Oldest first; the empty COMMENTED review (line comments only) is left out.
assert.deepEqual(d.timeline.map((e) => [e.author, e.kind, e.verdict ?? ""]), [["dee", "review", "COMMENTED"], ["bob", "comment", ""], ["cy", "review", "APPROVED"]]);
assert.deepEqual(d.requested, ["eve", "core-team"]);
assert.equal(d.commits[0].author, "ann");
assert.equal(parsePrDetail("[]"), null);

assert.equal(mergeBlocker(d), null); // failing checks alone do not block
assert.match(mergeBlocker(detail({ isDraft: true })), /draft/i);
assert.match(mergeBlocker(detail({ mergeable: "CONFLICTING" })), /Conflicts with main/);
assert.match(mergeBlocker(detail({ mergeStateStatus: "BLOCKED" })), /branch protection/);
assert.match(mergeBlocker(detail({ mergeStateStatus: "BEHIND" })), /Behind main/);
assert.match(mergeBlocker(detail({ state: "MERGED" })), /Already merged/);

// Review threads, in the shape gh_pr_threads returns (taken from a real response).
const threads = parseThreads(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [
  { id: "T1", isResolved: true, isOutdated: true, path: "a.go", line: null, originalLine: 40, diffSide: "RIGHT",
    comments: { nodes: [{ databaseId: 7, body: "fix", createdAt: "2026-10-01T00:00:00Z", author: { login: "ann" } }] } },
  { id: "T2", isResolved: false, isOutdated: false, path: "b.go", line: 3, originalLine: 3, diffSide: "LEFT",
    comments: { nodes: [] } },
] } } } } }));
assert.equal(threads.length, 2);
assert.deepEqual([threads[0].line, threads[0].originalLine, threads[0].outdated, threads[0].resolved], [null, 40, true, true]);
assert.equal(threads[0].comments[0].author, "ann");
assert.equal(threads[1].side, "LEFT");
assert.deepEqual(parseThreads("{}"), []);
assert.deepEqual(parseThreads("nope"), []);

// origin wins over a remote that sorts before it; otherwise the first; none: origin.
assert.equal(primaryRemote(["local", "origin"]), "origin");
assert.equal(primaryRemote(["upstream", "zfork"]), "upstream");
assert.equal(primaryRemote([]), "origin");

// ---- GitLab merge requests (synthetic JSON, in GitLab's REST shape).

const mrs = parseMrRows(JSON.stringify([
  { id: 9001, iid: 12, title: "Add login", web_url: "https://gl/x/-/merge_requests/12", draft: false, detailed_merge_status: "mergeable",
    source_branch: "feat/login", target_branch: "main", author: { username: "ana" }, updated_at: "2026-10-01T10:00:00Z" },
  { id: 9002, iid: 13, title: "WIP", web_url: "u", draft: true, detailed_merge_status: "requested_changes",
    source_branch: "feat/wip", target_branch: "main", author: { username: "bo" }, updated_at: "" },
]));
assert.equal(mrs[0].number, 12, "the number is the iid, not the global id");
assert.deepEqual([mrs[0].head, mrs[0].base, mrs[0].author, mrs[0].state], ["feat/login", "main", "ana", "none"]);
assert.deepEqual([mrs[1].isDraft, mrs[1].state, mrs[1].review], [true, "failing", "CHANGES_REQUESTED"]);
assert.deepEqual(parseMrRows("nope"), []);
assert.equal(mrState("ci_still_running"), "pending");
assert.equal(mrState("not_approved"), "none");
assert.equal(mrBlocker("checking", "main"), null, "still being worked out does not hold the merge back");
assert.match(mrBlocker("conflict", "main"), /Conflicts with main/);

const mr = JSON.stringify({
  id: 9001, iid: 12, title: "Add login", description: "Body", web_url: "w", state: "opened", draft: false,
  author: { username: "ana" }, source_branch: "feat/login", target_branch: "main", sha: "h2",
  detailed_merge_status: "discussions_not_resolved", changes_count: "1000+", labels: ["ui"], reviewers: [{ username: "bo" }],
  head_pipeline: { id: 77, status: "failed", web_url: "p" }, diff_refs: { base_sha: "b1", start_sha: "s1", head_sha: "h2" },
});
const discussions = JSON.stringify([
  { id: "d1", notes: [{ id: 1, body: "added 3 commits", system: true, author: { username: "ana" }, created_at: "2026-10-01T09:00:00Z" }] },
  { id: "d2", notes: [{ id: 2, body: "Looks good", system: false, author: { username: "bo" }, created_at: "2026-10-01T11:00:00Z" }] },
  { id: "d3", notes: [{ id: 3, body: "approved this merge request", system: true, author: { username: "bo" }, created_at: "2026-10-01T12:00:00Z" }] },
  { id: "d4", notes: [
    { id: 4, body: "Rename this", system: false, resolved: false, author: { username: "bo" }, created_at: "2026-10-01T10:30:00Z",
      position: { new_path: "a.ts", old_path: "a.ts", new_line: 5, old_line: null, head_sha: "h2" } },
    { id: 5, body: "Done", system: false, resolved: false, author: { username: "ana" }, created_at: "2026-10-01T10:40:00Z", position: { new_path: "a.ts", new_line: 5, head_sha: "h2" } },
  ] },
  { id: "d5", notes: [{ id: 6, body: "Old", system: false, resolved: true, author: { username: "bo" }, created_at: "",
    position: { new_path: "b.ts", old_path: "b.ts", new_line: null, old_line: 9, head_sha: "h1" } }] },
]);
const md = parseMrDetail(mr, JSON.stringify({ approved: true, approved_by: [{ user: { username: "bo" } }], user_can_approve: false, user_has_approved: false }),
  discussions, JSON.stringify([{ id: "c2", title: "second", author_name: "Ana", committed_date: "2" }, { id: "c1", title: "first", author_name: "Ana", committed_date: "1" }]));
assert.deepEqual([md.number, md.state, md.head, md.base, md.headOid, md.baseOid], [12, "OPEN", "feat/login", "main", "h2", "b1"]);
assert.equal(md.changedFiles, 1000, "changes_count is a string, 1000+ when truncated");
assert.equal(md.additions, null);
assert.deepEqual(md.checks, [{ name: "Pipeline #77", state: "failing", url: "p" }]);
assert.deepEqual(md.timeline.map((e) => [e.kind, e.author, e.verdict ?? ""]), [["comment", "bo", ""], ["review", "bo", "APPROVED"]],
  "people's comments and approvals, oldest first; no system noise, no line comments");
assert.deepEqual(md.commits.map((c) => c.oid), ["c1", "c2"], "oldest first");
assert.deepEqual([md.requested, md.labels[0].name, md.review], [["bo"], "ui", "APPROVED"]);
assert.deepEqual(md.diffRefs, { base: "b1", start: "s1", head: "h2" });
assert.equal(mergeBlocker(md), "Every thread must be resolved first.");
assert.equal(mergeBlocker({ ...md, state: "MERGED" }), "Already merged.");
assert.equal(mergeBlocker({ ...md, blocker: null }), null);
assert.equal(parseMrDetail("{}", "", "", ""), null);

const mt = parseMrThreads(discussions, "h2");
assert.equal(mt.length, 2, "only discussions on a line");
assert.deepEqual([mt[0].id, mt[0].path, mt[0].line, mt[0].side, mt[0].outdated, mt[0].comments.length], ["d4", "a.ts", 5, "RIGHT", false, 2]);
assert.deepEqual([mt[1].line, mt[1].originalLine, mt[1].side, mt[1].outdated, mt[1].resolved], [null, 9, "LEFT", true, true],
  "written against an older head: outdated, listed but not placed");


console.log("prs.check.mjs: all assertions passed");
