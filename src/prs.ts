// Pull requests: the pure parts, checked by prs.check.mjs.
//
// Deck works with pull requests through the GitHub CLI (gh_run) and with GitLab's merge requests
// through the GitLab CLI (glab_run, glab_api), each of which already holds the user's sign-in.
// Where neither applies, it opens the host's own "new pull request" page with both branches filled
// in instead. Everything here is the arithmetic around that: which host a remote is, the page to
// open, a first draft of the title and description, and each host's JSON read into one shape
// (PrRow, PrDetail, PrThread) that the review view draws whichever host it came from.

/**
 * Fired on window with the repo root as detail after a pull request is created, reviewed, merged,
 * closed or changed, so the list and the branch pills re-read. Its own event, not deck-git-changed:
 * that one fires on every stage, and a `gh pr list` behind each would be a network call per click.
 */
export const PR_CHANGED = "deck-pr-changed";

/**
 * The remote that pushes and pull requests go to: `origin` when there is one, otherwise the first.
 * Not simply the first — `git remote` lists alphabetically, so a second remote named, say,
 * `local` came before `origin` and a PR's branch was pushed there instead of to GitHub.
 */
export const primaryRemote = (remotes: string[]) => (remotes.includes("origin") ? "origin" : remotes[0] ?? "origin");

export type Host = "github" | "gitlab" | "bitbucket" | "other";
export interface RemoteRepo { host: Host; /** https://host/owner/repo, no trailing slash or .git */ web: string }

/** A remote URL — https, ssh, or scp-style git@host:owner/repo — as a host and its web address. */
export function parseRemote(url: string): RemoteRepo | null {
  const u = url.trim();
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::\d+)?[/:](.+?)(?:\.git)?\/?$/.exec(u);
  if (!m) return null;
  const [, domain, path] = m;
  // ponytail: a self-hosted GitLab is recognised by "gitlab" in its name (gitlab.example.com,
  // gitlab-ce.example.dev). One named otherwise reads as "other"; asking `glab auth status
  // --hostname` would catch it, at a process start per lookup.
  const host: Host = domain === "github.com" ? "github"
    : domain.includes("gitlab") ? "gitlab"
    : domain === "bitbucket.org" ? "bitbucket"
    : "other";
  return { host, web: `https://${domain}/${path}` };
}

/** The host's page for opening a pull request from `head` into `base`, or null for a host we do not know. */
export function compareUrl(r: RemoteRepo, base: string, head: string): string | null {
  const e = encodeURIComponent;
  switch (r.host) {
    case "github": return `${r.web}/compare/${e(base)}...${e(head)}?expand=1`;
    case "gitlab": return `${r.web}/-/merge_requests/new?merge_request[source_branch]=${e(head)}&merge_request[target_branch]=${e(base)}`;
    case "bitbucket": return `${r.web}/pull-requests/new?source=${e(head)}&dest=${e(base)}`;
    default: return null;
  }
}

/** "feat/graph-kraken" → "Graph kraken": the last path segment, words spaced, first letter up. */
export function humanizeBranch(branch: string): string {
  const words = branch.split("/").pop()!.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : branch;
}

/**
 * A first draft of a pull request. One commit: its subject is the title. Several: the branch's
 * name is, since no one subject speaks for them all. The repo's template wins for the description;
 * without one, the commits as a list.
 */
export function draftPr(head: string, subjects: string[], template: string | null): { title: string; body: string } {
  return {
    title: subjects.length === 1 ? subjects[0] : humanizeBranch(head),
    body: template?.trim() ? template : subjects.map((s) => `- ${s}`).join("\n"),
  };
}

export type PrState = "passing" | "failing" | "pending" | "none";
export interface PrInfo { number: number; url: string; title: string; isDraft: boolean; state: PrState; review: string }

interface Check { conclusion?: string | null; state?: string | null; status?: string | null }

/**
 * One pull request's state, as its pill shows it. Changes requested or a failed check: failing.
 * Anything still running: pending. Every check passed, or approved with none: passing.
 */
export function prState(checks: Check[], reviewDecision: string): PrState {
  const bad = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
  if (reviewDecision === "CHANGES_REQUESTED") return "failing";
  if (checks.some((c) => bad.has(String(c.conclusion ?? c.state ?? "").toUpperCase()))) return "failing";
  // A check run reports status and conclusion; a commit status reports only state.
  const done = (c: Check) => (c.status ? c.status.toUpperCase() === "COMPLETED" : c.state != null && c.state.toUpperCase() !== "PENDING");
  if (checks.some((c) => !done(c))) return "pending";
  if (checks.length || reviewDecision === "APPROVED") return "passing";
  return "none";
}

/** The JSON fields asked of `gh pr list`, for the pills and the pull-request list alike. */
export const PR_LIST_FIELDS = "number,title,url,headRefName,baseRefName,author,isDraft,reviewDecision,statusCheckRollup,updatedAt";

/** One row of the pull-request list. */
export interface PrRow extends PrInfo { head: string; base: string; author: string; updatedAt: string }

const login = (a: unknown) => String((a as { login?: string } | null)?.login ?? "");

/** `gh pr list --json PR_LIST_FIELDS` as rows, in gh's order (newest first). */
export function parsePrRows(json: string): PrRow[] {
  let rows: unknown;
  try { rows = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[]).map((r) => ({
    number: Number(r.number), url: String(r.url ?? ""), title: String(r.title ?? ""),
    isDraft: !!r.isDraft, review: String(r.reviewDecision ?? ""),
    state: prState(Array.isArray(r.statusCheckRollup) ? (r.statusCheckRollup as Check[]) : [], String(r.reviewDecision ?? "")),
    head: String(r.headRefName ?? ""), base: String(r.baseRefName ?? ""),
    author: login(r.author), updatedAt: String(r.updatedAt ?? ""),
  }));
}

/** The open pull requests keyed by head branch, for the branch pills. The first per branch wins. */
export function byHead(rows: PrRow[]): Map<string, PrInfo> {
  const out = new Map<string, PrInfo>();
  for (const r of rows) if (r.head && !out.has(r.head)) out.set(r.head, r);
  return out;
}
export const parsePrList = (json: string) => byHead(parsePrRows(json));

// ---- One pull request, for the review view ---------------------------------------------------

/** The JSON fields asked of `gh pr view`. */
export const PR_VIEW_FIELDS = "number,title,body,url,state,isDraft,author,headRefName,baseRefName,headRefOid,baseRefOid,"
  + "mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,reviews,comments,commits,reviewRequests,labels,"
  + "additions,deletions,changedFiles,createdAt";

export interface PrCheck { name: string; state: PrState; url: string }
export interface PrEvent { kind: "comment" | "review"; author: string; body: string; at: string; /** a review's verdict */ verdict?: string }
export interface PrCommit { oid: string; headline: string; author: string; at: string }
export interface PrDetail {
  number: number; title: string; body: string; url: string;
  /** OPEN, CLOSED or MERGED */ state: string; isDraft: boolean; author: string;
  head: string; base: string; headOid: string; baseOid: string;
  mergeable: string; mergeState: string; review: string;
  checks: PrCheck[]; timeline: PrEvent[]; commits: PrCommit[];
  requested: string[]; labels: { name: string; color: string }[];
  /** Null where the host does not say (GitLab gives no line totals). */
  additions: number | null; deletions: number | null; changedFiles: number;
  /** GitLab only. Why it cannot be merged (null: it can), from GitLab's own verdict. */
  blocker?: string | null;
  /** GitLab only: the three commits a line comment is pinned to. */
  diffRefs?: { base: string; start: string; head: string };
  /** GitLab only: whether you have approved it. */
  approvedByMe?: boolean;
}

/** `gh pr view --json PR_VIEW_FIELDS` as what the review view shows. Null if it is not that. */
export function parsePrDetail(json: string): PrDetail | null {
  let r: Record<string, unknown>;
  try { r = JSON.parse(json); } catch { return null; }
  if (!r || typeof r !== "object" || r.number == null) return null;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const checks = arr(r.statusCheckRollup).map((c) => ({
    name: String(c.name ?? c.context ?? "check"),
    state: prState([c as Check], ""),
    url: String(c.detailsUrl ?? c.targetUrl ?? ""),
  }));
  // One conversation, oldest first. A review with no text and only a plain "commented" verdict
  // is the shell around line comments, which this view does not show — it would be an empty row.
  const timeline: PrEvent[] = [
    ...arr(r.comments).map((c): PrEvent => ({ kind: "comment", author: login(c.author), body: String(c.body ?? ""), at: String(c.createdAt ?? "") })),
    ...arr(r.reviews)
      .filter((v) => String(v.body ?? "").trim() || String(v.state ?? "") !== "COMMENTED")
      .map((v): PrEvent => ({ kind: "review", author: login(v.author), body: String(v.body ?? ""), at: String(v.submittedAt ?? ""), verdict: String(v.state ?? "") })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return {
    number: Number(r.number), title: String(r.title ?? ""), body: String(r.body ?? ""), url: String(r.url ?? ""),
    state: String(r.state ?? ""), isDraft: !!r.isDraft, author: login(r.author),
    head: String(r.headRefName ?? ""), base: String(r.baseRefName ?? ""),
    headOid: String(r.headRefOid ?? ""), baseOid: String(r.baseRefOid ?? ""),
    mergeable: String(r.mergeable ?? ""), mergeState: String(r.mergeStateStatus ?? ""), review: String(r.reviewDecision ?? ""),
    checks, timeline,
    commits: arr(r.commits).map((c) => ({
      oid: String(c.oid ?? ""), headline: String(c.messageHeadline ?? ""),
      author: login(arr(c.authors)[0]) || String((arr(c.authors)[0] as { name?: string } | undefined)?.name ?? ""),
      at: String(c.committedDate ?? ""),
    })),
    // A request names a user (login) or a team (name).
    requested: arr(r.reviewRequests).map((q) => String(q.login ?? q.name ?? "")).filter(Boolean),
    labels: arr(r.labels).map((l) => ({ name: String(l.name ?? ""), color: String(l.color ?? "") })),
    additions: Number(r.additions ?? 0), deletions: Number(r.deletions ?? 0), changedFiles: Number(r.changedFiles ?? 0),
  };
}

/**
 * Why the pull request cannot be merged from here, or null when it can. Failing checks do not
 * block — GitHub lets them through unless branch protection says otherwise, which BLOCKED covers.
 */
export function mergeBlocker(d: PrDetail): string | null {
  if (d.state === "MERGED") return "Already merged.";
  if (d.state === "CLOSED") return "Closed. Reopen it to merge.";
  if (d.blocker !== undefined) return d.blocker;
  if (d.isDraft || d.mergeState === "DRAFT") return "A draft. Mark it ready for review first.";
  if (d.mergeable === "CONFLICTING" || d.mergeState === "DIRTY") return `Conflicts with ${d.base}. Resolve them on the branch first.`;
  if (d.mergeState === "BLOCKED") return "Blocked by branch protection: required reviews or checks are missing.";
  if (d.mergeState === "BEHIND") return `Behind ${d.base}, and the branch must be up to date to merge.`;
  return null;
}

// ---- Line comments ------------------------------------------------------------------------

export interface PrThreadComment { id: number; author: string; body: string; at: string }
/**
 * One review thread: a conversation on a line of the diff. `line` is where it sits in the
 * current diff — null once the code under it has changed (`outdated`), when `originalLine` is
 * where it was written. RIGHT is the new version's line, LEFT the old one's.
 */
export interface PrThread {
  id: string; resolved: boolean; outdated: boolean; path: string;
  line: number | null; originalLine: number | null; side: "LEFT" | "RIGHT";
  comments: PrThreadComment[];
}

/** gh_pr_threads' GraphQL JSON as threads, in GitHub's order. Empty on anything else. */
export function parseThreads(json: string): PrThread[] {
  let r: unknown;
  try { r = JSON.parse(json); } catch { return []; }
  const nodes = (r as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: unknown } } } } })
    ?.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!Array.isArray(nodes)) return [];
  return (nodes as Record<string, unknown>[]).map((t) => ({
    id: String(t.id ?? ""), resolved: !!t.isResolved, outdated: !!t.isOutdated, path: String(t.path ?? ""),
    line: typeof t.line === "number" ? t.line : null,
    originalLine: typeof t.originalLine === "number" ? t.originalLine : null,
    side: t.diffSide === "LEFT" ? "LEFT" as const : "RIGHT" as const,
    comments: (((t.comments as { nodes?: unknown })?.nodes ?? []) as Record<string, unknown>[]).map((c) => ({
      id: Number(c.databaseId ?? 0), author: login(c.author), body: String(c.body ?? ""), at: String(c.createdAt ?? ""),
    })),
  }));
}

// ---- GitLab merge requests -------------------------------------------------------------------
//
// GitLab's REST JSON (via glab_api) read into the shapes above. A merge request's number is its
// `iid`, the one people write as !12; its `id` is global to the instance and never shown.

type Json = Record<string, unknown>;
const user = (u: unknown) => String((u as { username?: string } | null)?.username ?? "");
const list = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
const parse = (json: string): unknown => { try { return JSON.parse(json); } catch { return null; } };

/**
 * A merge request's pill colour from `detailed_merge_status`, which the list carries (the pipeline
 * itself is not in it): a required pipeline that failed, a conflict or requested changes is
 * failing, one still being worked out pending. Anything else is none — even "mergeable", which
 * says nothing of a pipeline the project does not require, and can sit beside a failed one.
 */
export function mrState(status: string): PrState {
  if (["ci_must_pass", "status_checks_must_pass", "conflict", "requested_changes"].includes(status)) return "failing";
  if (["ci_still_running", "checking", "unchecked", "preparing", "approvals_syncing"].includes(status)) return "pending";
  return "none";
}

/** A pipeline's status as a check's state. */
const pipelineState = (s: string): PrState =>
  s === "success" ? "passing" : ["failed", "canceled"].includes(s) ? "failing" : s && s !== "skipped" && s !== "manual" ? "pending" : "none";

const MR_STATE: Record<string, string> = { opened: "OPEN", closed: "CLOSED", locked: "CLOSED", merged: "MERGED" };

/** `GET projects/:id/merge_requests` as rows, in GitLab's order. */
export function parseMrRows(json: string): PrRow[] {
  return list(parse(json)).map((r) => ({
    number: Number(r.iid), url: String(r.web_url ?? ""), title: String(r.title ?? ""),
    isDraft: !!r.draft, review: r.detailed_merge_status === "requested_changes" ? "CHANGES_REQUESTED" : "",
    state: mrState(String(r.detailed_merge_status ?? "")),
    head: String(r.source_branch ?? ""), base: String(r.target_branch ?? ""),
    author: user(r.author), updatedAt: String(r.updated_at ?? ""),
  }));
}

/** Why GitLab will not merge it yet, from `detailed_merge_status`; null when it will. */
export function mrBlocker(status: string, target: string): string | null {
  switch (status) {
    case "mergeable": return null;
    case "draft_status": return "A draft. Mark it ready first.";
    case "conflict": return `Conflicts with ${target}. Resolve them on the branch first.`;
    case "need_rebase": return `Needs a rebase onto ${target} before it can merge.`;
    case "not_approved": return "Needs approval first.";
    case "requested_changes": return "A reviewer requested changes.";
    case "ci_must_pass": case "status_checks_must_pass": return "The pipeline must pass first.";
    case "ci_still_running": return "The pipeline is still running.";
    case "discussions_not_resolved": return "Every thread must be resolved first.";
    // GitLab works these out lazily, often only once someone asks, and a merge sent meanwhile
    // goes through; holding the button back would leave it stuck until a refresh.
    case "checking": case "unchecked": case "preparing": case "approvals_syncing": return null;
    default: return status ? `GitLab will not merge it yet (${status.replace(/_/g, " ")}).` : null;
  }
}

/**
 * One merge request for the review view, from four reads: the merge request, its approvals, its
 * discussions and its commits. The conversation is the comments that are not on a line, plus
 * GitLab's own notes for approvals and change requests. Its other system notes ("added 3
 * commits", "changed the description") are most of what it holds and would bury the people.
 */
export function parseMrDetail(mrJson: string, approvalsJson: string, discussionsJson: string, commitsJson: string): PrDetail | null {
  const r = parse(mrJson) as Json | null;
  if (!r || typeof r !== "object" || r.iid == null) return null;
  const a = (parse(approvalsJson) ?? {}) as Json;
  const status = String(r.detailed_merge_status ?? "");
  const pipe = r.head_pipeline as Json | null;
  const refs = (r.diff_refs ?? {}) as Json;
  const timeline: PrEvent[] = [];
  for (const d of list(parse(discussionsJson))) {
    for (const n of list(d.notes)) {
      if (n.position) continue; // a line comment: the Files tab shows it
      const body = String(n.body ?? ""), at = String(n.created_at ?? "");
      if (!n.system) timeline.push({ kind: "comment", author: user(n.author), body, at });
      else if (/^approved this merge request/.test(body)) timeline.push({ kind: "review", author: user(n.author), body: "", at, verdict: "APPROVED" });
      else if (/^requested changes/.test(body)) timeline.push({ kind: "review", author: user(n.author), body: "", at, verdict: "CHANGES_REQUESTED" });
    }
  }
  timeline.sort((x, y) => x.at.localeCompare(y.at));
  return {
    number: Number(r.iid), title: String(r.title ?? ""), body: String(r.description ?? ""), url: String(r.web_url ?? ""),
    state: MR_STATE[String(r.state)] ?? String(r.state ?? "").toUpperCase(), isDraft: !!r.draft, author: user(r.author),
    head: String(r.source_branch ?? ""), base: String(r.target_branch ?? ""),
    headOid: String(refs.head_sha ?? r.sha ?? ""), baseOid: String(refs.base_sha ?? ""),
    mergeable: "", mergeState: "", blocker: mrBlocker(status, String(r.target_branch ?? "")),
    review: status === "requested_changes" ? "CHANGES_REQUESTED" : a.approved && list(a.approved_by).length ? "APPROVED" : "",
    checks: pipe ? [{ name: `Pipeline #${pipe.id}`, state: pipelineState(String(pipe.status ?? "")), url: String(pipe.web_url ?? "") }] : [],
    timeline,
    // GitLab lists commits newest first; the view, as on GitHub, oldest first.
    commits: list(parse(commitsJson)).map((c) => ({
      oid: String(c.id ?? ""), headline: String(c.title ?? ""), author: String(c.author_name ?? ""), at: String(c.committed_date ?? ""),
    })).reverse(),
    requested: list(r.reviewers).map(user).filter(Boolean),
    labels: list(r.labels).map((l) => ({ name: String(l), color: "" })),
    // A string: "12", or "1000+" when GitLab stopped counting.
    additions: null, deletions: null, changedFiles: parseInt(String(r.changes_count ?? "0"), 10) || 0,
    diffRefs: { base: String(refs.base_sha ?? ""), start: String(refs.start_sha ?? ""), head: String(refs.head_sha ?? "") },
    approvedByMe: !!a.user_has_approved,
  };
}

/**
 * The discussions on lines of the diff, as threads. One written against an older head is
 * outdated: its line may no longer be the line it was about, so it is listed, not placed.
 */
export function parseMrThreads(discussionsJson: string, headSha: string): PrThread[] {
  const out: PrThread[] = [];
  for (const d of list(parse(discussionsJson))) {
    const notes = list(d.notes);
    const pos = notes[0]?.position as Json | undefined;
    if (!pos) continue;
    const right = pos.new_line != null;
    const ln = Number(right ? pos.new_line : pos.old_line) || null;
    const outdated = !!pos.head_sha && pos.head_sha !== headSha;
    out.push({
      id: String(d.id ?? ""), resolved: !!notes[0].resolved, outdated,
      path: String(pos.new_path ?? pos.old_path ?? ""),
      line: outdated ? null : ln, originalLine: ln, side: right ? "RIGHT" : "LEFT",
      comments: notes.map((n) => ({ id: Number(n.id ?? 0), author: user(n.author), body: String(n.body ?? ""), at: String(n.created_at ?? "") })),
    });
  }
  return out;
}
