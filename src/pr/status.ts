// What the pull request views say about a pull request, worked out from what the host gave: the
// list's groups and each row's one-word state, the "before it can merge" rows, the reviewers, and
// the one action the header offers. Pure (status.check.mjs); PrList and PrView draw it.
import { mergeBlocker, type PrDetail, type PrRow } from "../prs";

// ---- The list -------------------------------------------------------------------------------

/** A bot's account: Renovate, Dependabot, GitHub's `[bot]` apps, and any `*-bot`/`*_bot`. */
export const isBot = (author: string) => /\[bot\]$|[-_.]bot$|^bot[-_]|^(renovate|dependabot|greenkeeper|snyk)/i.test(author.trim());

export interface PrGroups { waiting: PrRow[]; yours: PrRow[]; others: PrRow[]; bots: PrRow[] }

/**
 * The open pull requests in the list's groups, each in one only: waiting for your review, yours,
 * bots', everyone else's. `review` and `mine` are the host's own answers to those questions, null
 * when it could not answer (the rows then fall to the groups after). `query` keeps the rows whose
 * title, number, author or branch has it.
 */
export function groupRows(all: PrRow[], review: PrRow[] | null, mine: PrRow[] | null, query = ""): PrGroups {
  const q = query.trim().toLowerCase();
  const hit = (r: PrRow) => !q || [r.title, String(r.number), r.author, r.head].some((x) => x.toLowerCase().includes(q.replace(/^[#!]/, "")));
  const waitingN = new Set((review ?? []).map((r) => r.number));
  const mineN = new Set((mine ?? []).map((r) => r.number));
  // The three answers come from separate calls: a row only one of them has still counts once.
  const byN = new Map<number, PrRow>();
  for (const r of [...all, ...(review ?? []), ...(mine ?? [])]) if (!byN.has(r.number)) byN.set(r.number, r);
  const g: PrGroups = { waiting: [], yours: [], others: [], bots: [] };
  for (const r of byN.values()) {
    if (!hit(r)) continue;
    (waitingN.has(r.number) ? g.waiting : mineN.has(r.number) ? g.yours : isBot(r.author) ? g.bots : g.others).push(r);
  }
  return g;
}

export type Tone = "ok" | "bad" | "wait" | "muted";

/** A row's state in a word or two, the one thing that decides it next; null when nothing does. */
export function rowStatus(r: PrRow): { label: string; tone: Tone } | null {
  if (r.isDraft) return { label: "Draft", tone: "muted" };
  if (r.review === "CHANGES_REQUESTED") return { label: "changes asked", tone: "bad" };
  if (r.state === "failing") return { label: "checks failed", tone: "bad" };
  if (r.state === "pending") return { label: "checks running", tone: "wait" };
  if (r.review === "APPROVED") return { label: "approved", tone: "ok" };
  return null;
}

// ---- One pull request -----------------------------------------------------------------------

export interface Readiness { label: string; value: string; tone: Tone }

// GitLab's detailed_merge_status values that mean it has not worked the answer out yet.
const GITLAB_UNKNOWN = new Set(["", "checking", "unchecked", "preparing", "approvals_syncing"]);

/**
 * What decides whether it can merge, a row each, saying only what the host told: an answer it is
 * still working out is shown as such, never as fine. GitLab's details are in `mergeState` (its
 * detailed_merge_status) with `blocker` set; GitHub's in `mergeable` and `mergeState`.
 */
export function readiness(d: PrDetail): Readiness[] {
  const gitlab = d.blocker !== undefined;
  const rows: Readiness[] = [];

  const asked = d.requested.length ? `waiting on ${d.requested.join(", ")}` : "";
  rows.push(
    d.review === "APPROVED" ? { label: "Review", value: "approved", tone: "ok" }
    : d.review === "CHANGES_REQUESTED" ? { label: "Review", value: "changes requested", tone: "bad" }
    : d.review === "REVIEW_REQUIRED" || (gitlab && d.mergeState === "not_approved") ? { label: "Review", value: asked || "needed", tone: "wait" }
    : { label: "Review", value: asked || "none asked", tone: asked ? "wait" : "muted" });

  const count = (s: string) => d.checks.filter((c) => c.state === s).length;
  const [failing, pending, passing] = [count("failing"), count("pending"), count("passing")];
  rows.push(
    failing ? { label: "Checks", value: `${failing} failed`, tone: "bad" }
    : pending ? { label: "Checks", value: `${pending} running`, tone: "wait" }
    : passing ? { label: "Checks", value: `${passing} passed`, tone: "ok" }
    : { label: "Checks", value: "none", tone: "muted" });

  const conflicts: Readiness = gitlab
    ? d.mergeState === "conflict" ? { label: "Conflicts", value: `with ${d.base}`, tone: "bad" }
      : d.mergeState === "need_rebase" ? { label: "Conflicts", value: `needs a rebase onto ${d.base}`, tone: "bad" }
      : GITLAB_UNKNOWN.has(d.mergeState) ? { label: "Conflicts", value: "being checked", tone: "muted" }
      : { label: "Conflicts", value: "none", tone: "ok" }
    : d.mergeable === "CONFLICTING" || d.mergeState === "DIRTY" ? { label: "Conflicts", value: `with ${d.base}`, tone: "bad" }
      : d.mergeable === "MERGEABLE" ? { label: "Conflicts", value: "none", tone: "ok" }
      : { label: "Conflicts", value: "being checked", tone: "muted" };
  rows.push(conflicts);

  if (d.isDraft) rows.push({ label: "Draft", value: "not ready for review", tone: "wait" });
  return rows;
}

/** Who was asked to review it and what each said last: approved, changes requested, or waiting. */
export function reviewers(d: PrDetail): { name: string; verdict: "approved" | "changes requested" | "commented" | "waiting"; tone: Tone }[] {
  const last = new Map<string, string>();
  for (const e of d.timeline) if (e.kind === "review" && e.verdict && e.author !== d.author) last.set(e.author, e.verdict);
  const out: ReturnType<typeof reviewers> = [];
  for (const [name, v] of last) {
    out.push(v === "APPROVED" ? { name, verdict: "approved", tone: "ok" }
      : v === "CHANGES_REQUESTED" ? { name, verdict: "changes requested", tone: "bad" }
      : { name, verdict: "commented", tone: "muted" });
  }
  for (const name of d.requested) if (!last.has(name)) out.push({ name, verdict: "waiting", tone: "wait" });
  return out;
}

export type Primary = "approve" | "merge" | "ready" | "reopen" | "blocked" | null;

/**
 * The one filled button in the header, which opens its box (it never acts by itself): approve when
 * your review is what it waits for, merge when nothing is in the way, otherwise what is. Null while
 * the review verdicts are still being asked (`canApprove` undefined), and for a merged one.
 */
export function primaryAction(d: PrDetail, canApprove: boolean | undefined): Primary {
  if (d.state === "MERGED") return null;
  if (d.state === "CLOSED") return "reopen";
  if (canApprove === undefined) return null;
  if (d.isDraft) return "ready";
  // A review is what it waits for: one required, someone asked, or GitLab's approval rule.
  const wanted = d.review === "REVIEW_REQUIRED" || d.requested.length > 0 || d.mergeState === "not_approved";
  if (canApprove && wanted && d.review !== "APPROVED" && !d.approvedByMe) return "approve";
  return mergeBlocker(d) ? "blocked" : "merge";
}
