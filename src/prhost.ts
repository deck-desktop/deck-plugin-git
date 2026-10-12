// Where a repo's pull requests live, and how to reach them: GitHub through the GitHub CLI (gh),
// GitLab through the GitLab CLI (glab). The review view, the branch pills and the create form ask
// a PrHost and never a CLI, so each host's commands, JSON and words stay in this one file and the
// UI draws both the same way (prs.ts reads both hosts' JSON into one shape).
import { useEffect, useState } from "react";
import { ghRun, ghPrThreads, ghPrLineComment, ghThreadReply, ghThreadResolve, glabRun, glabApi, gitRemotes, gitRemoteUrl, gitFetchPr } from "../shim/bridge.js";
import {
  parseRemote, primaryRemote, parsePrRows, parsePrDetail, parseThreads, parseMrRows, parseMrDetail, parseMrThreads,
  PR_LIST_FIELDS, PR_VIEW_FIELDS, type PrRow, type PrDetail, type PrThread,
} from "./prs";

export type PrFilter = "review" | "mine" | "all";
export type Verdict = "approve" | "request-changes" | "comment" | "revoke";
export type MergeMethod = "merge" | "squash" | "rebase";
export interface RepoMeta { defaultBranch: string; people: { login: string; name?: string }[]; labels: { name: string; color?: string }[] }
export interface NewPr { base: string; head: string; title: string; body: string; draft: boolean; reviewers: string[]; labels: string[] }

export interface PrHost {
  kind: "github" | "gitlab";
  /** "GitHub": where its page is. */
  name: string;
  /** "pull request" / "merge request", and "PR" / "MR". */
  noun: string; short: string;
  /** How a number is written: #12 on GitHub, !12 on GitLab. */
  sign: string;
  list(filter: PrFilter): Promise<PrRow[]>;
  view(n: number): Promise<PrDetail | null>;
  /** The verdicts a review can give this one, and why one is not on offer. */
  verdicts(d: PrDetail): Promise<{ v: Verdict; label: string; why?: string }[]>;
  review(n: number, verdict: Verdict, body: string): Promise<unknown>;
  comment(n: number, body: string): Promise<unknown>;
  merge(n: number, method: MergeMethod, deleteBranch: boolean): Promise<unknown>;
  close(n: number, comment: string): Promise<unknown>;
  reopen(n: number): Promise<unknown>;
  checkout(n: number): Promise<unknown>;
  setDraft(n: number, draft: boolean): Promise<unknown>;
  threads(d: PrDetail): Promise<PrThread[]>;
  /** `other`: the same line on the diff's other side, when it is an unchanged line (GitLab needs it). */
  lineComment(d: PrDetail, path: string, line: number, side: "LEFT" | "RIGHT", other: number | null, body: string): Promise<unknown>;
  reply(d: PrDetail, thread: string, body: string): Promise<unknown>;
  resolve(d: PrDetail, thread: string, resolve: boolean): Promise<unknown>;
  /** Fetch its head, so its commits can be diffed here. */
  fetchHead(remote: string, n: number, base: string): Promise<unknown>;
  meta(): Promise<RepoMeta>;
  /** Returns its address. */
  create(p: NewPr): Promise<string>;
}

/** A host's error as something to read. A missing CLI becomes something to act on. */
export function prError(e: unknown): string {
  const m = String(e).replace(/^Error:\s*/, "");
  if (m === "gh-missing") return "The GitHub CLI (gh) is not installed. Install it and run `gh auth login`.";
  if (m === "glab-missing") return "The GitLab CLI (glab) is not installed. Install it and run `glab auth login --hostname <your GitLab>`.";
  return m;
}

function github(root: string): PrHost {
  const pr = (args: string[]) => ghRun(root, ["pr", ...args]);
  const FILTER: Record<PrFilter, string[]> = { review: ["--search", "review-requested:@me"], mine: ["--author", "@me"], all: [] };
  return {
    kind: "github", name: "GitHub", noun: "pull request", short: "PR", sign: "#",
    list: async (f) => parsePrRows(await pr(["list", "--state", "open", "--limit", "100", "--json", PR_LIST_FIELDS, ...FILTER[f]])),
    view: async (n) => parsePrDetail(await pr(["view", String(n), "--json", PR_VIEW_FIELDS])),
    // GitHub refuses an approval or a change request from the PR's own author; only a comment goes
    // through. Asked of gh rather than compared by name, since gh knows which account is signed in.
    verdicts: async (d) => {
      const mine = await pr(["list", "--author", "@me", "--state", "open", "--limit", "200", "--json", "number"])
        .then((j) => (JSON.parse(j) as { number: number }[]).some((p) => p.number === d.number)).catch(() => false);
      const why = mine ? "GitHub does not let you approve or request changes on your own pull request" : undefined;
      return [{ v: "approve", label: "Approve", why }, { v: "request-changes", label: "Request changes", why }, { v: "comment", label: "Comment" }];
    },
    review: (n, v, body) => pr(["review", String(n), `--${v}`, ...(body ? ["--body", body] : [])]),
    comment: (n, body) => pr(["comment", String(n), "--body", body]),
    merge: (n, m, del) => pr(["merge", String(n), `--${m}`, ...(del ? ["--delete-branch"] : [])]),
    close: (n, c) => pr(["close", String(n), ...(c ? ["--comment", c] : [])]),
    reopen: (n) => pr(["reopen", String(n)]),
    checkout: (n) => pr(["checkout", String(n)]),
    setDraft: (n, draft) => pr(["ready", String(n), ...(draft ? ["--undo"] : [])]),
    threads: async (d) => parseThreads(await ghPrThreads(root, d.number)),
    lineComment: (d, path, line, side, _other, body) => ghPrLineComment(root, d.number, d.headOid, path, line, side, body),
    reply: (_d, t, body) => ghThreadReply(root, t, body),
    resolve: (_d, t, r) => ghThreadResolve(root, t, r),
    fetchHead: (remote, n, base) => gitFetchPr(root, remote, n, base),
    meta: async () => {
      const m = JSON.parse(await ghRun(root, ["repo", "view", "--json", "defaultBranchRef,assignableUsers,labels"])) as {
        defaultBranchRef?: { name: string }; assignableUsers?: { login: string; name?: string }[]; labels?: { name: string; color?: string }[];
      };
      return { defaultBranch: m.defaultBranchRef?.name || "main", people: m.assignableUsers ?? [], labels: m.labels ?? [] };
    },
    create: async (p) => {
      const out = await pr(["create", "--base", p.base, "--head", p.head, "--title", p.title, "--body", p.body,
        ...(p.draft ? ["--draft"] : []), ...p.reviewers.flatMap((r) => ["--reviewer", r]), ...p.labels.flatMap((l) => ["--label", l])]);
      return out.trim().split(/\s+/).pop() ?? "";
    },
  };
}

function gitlab(root: string): PrHost {
  const mr = (args: string[]) => glabRun(root, ["mr", ...args]);
  const at = (n: number, rest = "") => `projects/:id/merge_requests/${n}${rest}`;
  const get = (path: string) => glabApi(root, "GET", path);
  let me: Promise<string> | null = null;
  const username = () => (me ??= get("user").then((j) => String((JSON.parse(j) as { username?: string }).username ?? "")));
  const comment = (n: number, body: string) => glabApi(root, "POST", at(n, "/notes"), [["body", body]]);
  return {
    kind: "gitlab", name: "GitLab", noun: "merge request", short: "MR", sign: "!",
    list: async (f) => {
      const who = f === "all" ? "" : `&${f === "review" ? "reviewer_username" : "author_username"}=${encodeURIComponent(await username())}`;
      return parseMrRows(await get(`projects/:id/merge_requests?state=opened&per_page=100&order_by=updated_at${who}`));
    },
    view: async (n) => {
      const [m, a, d, c] = await Promise.all([get(at(n)), get(at(n, "/approvals")).catch(() => "{}"),
        get(at(n, "/discussions?per_page=100")).catch(() => "[]"), get(at(n, "/commits?per_page=100")).catch(() => "[]")]);
      return parseMrDetail(m, a, d, c);
    },
    // GitLab has no "request changes" through glab. Approve is always offered: its
    // user_can_approve said false on a merge request whose approval then went through, so GitLab's
    // own refusal, shown as the error, is the answer to trust.
    verdicts: async (d) => [
      d.approvedByMe ? { v: "revoke", label: "Revoke approval" } : { v: "approve", label: "Approve" },
      { v: "comment", label: "Comment" },
    ],
    review: async (n, v, body) => {
      if (v === "approve") await mr(["approve", String(n)]);
      if (v === "revoke") await mr(["revoke", String(n)]);
      if (body) await comment(n, body);
    },
    comment,
    // Merged now: glab otherwise sets auto-merge while a pipeline runs, which is not what was asked.
    merge: async (n, m, del) => {
      const args = ["merge", String(n), "--yes", "--auto-merge=false",
        ...(m === "squash" ? ["--squash"] : m === "rebase" ? ["--rebase"] : []), ...(del ? ["--remove-source-branch"] : [])];
      // ponytail: --rebase rebases the branch, then GitLab refuses the merge (405) until it has
      // taken the new head in, a few seconds. Three tries, three seconds apart; polling
      // rebase_in_progress would be exact.
      for (let i = 0; ; i++) {
        try { return await mr(args); } catch (e) {
          if (m !== "rebase" || i === 2 || !String(e).includes("405")) throw e;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    },
    close: async (n, c) => { if (c) await comment(n, c); return mr(["close", String(n)]); },
    reopen: (n) => mr(["reopen", String(n)]),
    checkout: (n) => mr(["checkout", String(n)]),
    setDraft: (n, draft) => mr(["update", String(n), draft ? "--draft" : "--ready", "--yes"]),
    threads: async (d) => parseMrThreads(await get(at(d.number, "/discussions?per_page=100")), d.headOid),
    // GitLab pins a line comment to the diff's three commits and needs both line numbers for an
    // unchanged line; an added line has only a new one, a removed line only an old one.
    lineComment: (d, path, line, side, other, body) => {
      const r = d.diffRefs ?? { base: d.baseOid, start: d.baseOid, head: d.headOid };
      const [oldLine, newLine] = side === "LEFT" ? [line, other] : [other, line];
      return glabApi(root, "POST", at(d.number, "/discussions"), [["body", body]], {
        position: {
          position_type: "text", base_sha: r.base, start_sha: r.start, head_sha: r.head, old_path: path, new_path: path,
          ...(oldLine != null ? { old_line: oldLine } : {}), ...(newLine != null ? { new_line: newLine } : {}),
        },
      });
    },
    reply: (d, t, body) => glabApi(root, "POST", at(d.number, `/discussions/${t}/notes`), [["body", body]]),
    resolve: (d, t, r) => glabApi(root, "PUT", at(d.number, `/discussions/${t}?resolved=${r}`)),
    fetchHead: (remote, n, base) => gitFetchPr(root, remote, n, base, true),
    meta: async () => {
      const [p, people, labels] = await Promise.all([get("projects/:id"), get("projects/:id/members/all?per_page=100").catch(() => "[]"),
        get("projects/:id/labels?per_page=100").catch(() => "[]")]);
      return {
        defaultBranch: String((JSON.parse(p) as { default_branch?: string }).default_branch || "main"),
        people: (JSON.parse(people) as { username: string; name?: string }[]).map((u) => ({ login: u.username, name: u.name })),
        labels: (JSON.parse(labels) as { name: string; color?: string }[]).map((l) => ({ name: l.name, color: l.color?.replace(/^#/, "") })),
      };
    },
    create: async (p) => {
      const out = await mr(["create", "--source-branch", p.head, "--target-branch", p.base, "--title", p.title,
        "--description", p.body.trim() || p.title, "--yes", ...(p.draft ? ["--draft"] : []),
        ...(p.reviewers.length ? ["--reviewer", p.reviewers.join(",")] : []), ...(p.labels.length ? ["--label", p.labels.join(",")] : [])]);
      return /https?:\/\/\S+/.exec(out)?.[0] ?? "";
    },
  };
}

const hosts = new Map<string, Promise<PrHost>>();

/**
 * The host of the repo at `root`, from its primary remote's address: GitLab for a GitLab remote,
 * GitHub otherwise (gh also serves GitHub Enterprise, whose hosts have no telling name). Kept per
 * repo for the session: a remote that changes host is rare enough to need a restart.
 */
export function prHost(root: string): Promise<PrHost> {
  let h = hosts.get(root);
  if (!h) {
    h = gitRemotes(root).then((names) => gitRemoteUrl(root, primaryRemote(names)))
      .then((url) => (parseRemote(url)?.host === "gitlab" ? gitlab(root) : github(root)))
      .catch(() => github(root));
    hosts.set(root, h);
  }
  return h;
}

/** The repo's PrHost, null until its remote has been read. */
export function usePrHost(root: string): PrHost | null {
  const [host, setHost] = useState<PrHost | null>(null);
  useEffect(() => {
    let alive = true;
    setHost(null);
    void prHost(root).then((h) => { if (alive) setHost(h); });
    return () => { alive = false; };
  }, [root]);
  return host;
}
