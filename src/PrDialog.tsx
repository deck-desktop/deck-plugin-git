// Create a pull request (a merge request on GitLab) from a branch: a form drafted from the
// branch's commits and the repo's template, sent through the host's CLI (gh, or glab). The branch
// is pushed first — neither takes a head that is not on the remote, and an unpushed commit would
// silently be left out. Without the CLI, the host's own page opens instead with both branches chosen.
import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  gitRefs, fsRead, openExternal,
} from "../shim/bridge.js";
import { gitRangeSubjects, gitRemoteUrl, gitPushBranch } from "./git";
import { parseRemote, compareUrl, draftPr } from "./prs";
import { usePrHost, type RepoMeta } from "./prhost";

/** Where a repo keeps its PR template, in the order GitHub looks; then GitLab's default one. */
const TEMPLATES = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "pull_request_template.md", "docs/pull_request_template.md",
  ".gitlab/merge_request_templates/Default.md", ".gitlab/merge_request_templates/default.md"];

export function PrDialog({ root, head, base: wantBase, remote, onClose, onDone, onFail }: {
  root: string;
  head: string;
  /** The target, when chosen already (a drop onto a branch); otherwise the repo's default branch. */
  base?: string;
  remote: string;
  onClose: () => void;
  /** Created (or the browser page opened). `url` is the PR when gh made it. */
  onDone: (url: string | null) => void;
  onFail: (title: string, e: unknown) => void;
}) {
  const host = usePrHost(root);
  const [meta, setMeta] = useState<RepoMeta | null>(null);
  // Whether the host's CLI answered (gh, or glab); null: still asking.
  const [gh, setGh] = useState<boolean | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  // Whether `head` exists here. A branch only on the remote is already where gh needs it, and
  // pushing a name with no local branch fails ("src refspec does not match any").
  const [headIsLocal, setHeadIsLocal] = useState(true);
  const [base, setBase] = useState(wantBase ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [touched, setTouched] = useState(false); // the user has typed; stop redrafting
  const [draft, setDraft] = useState(false);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [openAfter, setOpenAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  // What the form offers: the repo's default branch, its people and labels (the host), and the branches.
  useEffect(() => {
    if (!host) return;
    void host.meta()
      .then((m) => { setMeta(m); setGh(true); setBase((b) => b || m.defaultBranch); })
      .catch(() => { setGh(false); setBase((b) => b || "main"); });
  }, [host]);
  useEffect(() => {
    void gitRefs(root).then((refs) => {
      const names = refs.filter((r) => r.kind === "remote" && !r.name.endsWith("/HEAD"))
        .map((r) => r.name.slice(r.name.indexOf("/") + 1));
      setBranches([...new Set([...names, ...refs.filter((r) => r.kind === "local").map((r) => r.name)])].filter((n) => n !== head).sort());
      setHeadIsLocal(refs.some((r) => r.kind === "local" && r.name === head));
    }).catch((e) => console.warn("[git] branches load failed", e));
  }, [root, head]);

  // The draft follows the base until the user writes something of their own.
  useEffect(() => {
    if (!base || touched) return;
    let alive = true;
    void (async () => {
      const subjects = await gitRangeSubjects(root, `${remote}/${base}`, head).catch(() => [] as string[]);
      const listed = subjects.length ? subjects : await gitRangeSubjects(root, base, head).catch(() => [] as string[]);
      let template: string | null = null;
      for (const t of TEMPLATES) { template = await fsRead(`${root}/${t}`).catch(() => null); if (template) break; }
      if (!alive) return;
      const d = draftPr(head, listed, template);
      setTitle(d.title); setBody(d.body);
    })();
    return () => { alive = false; };
  }, [root, remote, base, head, touched]);

  const people = useMemo(() => (meta?.people ?? [])
    .filter((u) => !filter || u.login.toLowerCase().includes(filter.toLowerCase()) || u.name?.toLowerCase().includes(filter.toLowerCase())), [meta, filter]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async () => {
    if (!title.trim() || !base || busy) return;
    setBusy(true);
    try {
      if (gh && host) {
        // Pushed first, with the upstream set: the host needs the head on the remote.
        if (headIsLocal) await gitPushBranch(root, remote, head);
        const url = await host.create({ base, head, title: title.trim(), body, draft, reviewers, labels });
        if (openAfter && url.startsWith("http")) void openExternal(url);
        onDone(url || null);
      } else {
        const repo = parseRemote(await gitRemoteUrl(root, remote));
        const page = repo && compareUrl(repo, base, head);
        if (!page) throw new Error("This remote's host is not one Deck knows how to open a pull request on, and neither the GitHub CLI (gh) nor the GitLab CLI (glab) answered for it.");
        if (headIsLocal) await gitPushBranch(root, remote, head);
        void openExternal(page);
        onDone(null);
      }
      onClose();
    } catch (e) {
      onFail(`Could not create the ${host?.noun ?? "pull request"}`, e);
    } finally {
      setBusy(false);
    }
  };

  const chip = (on: boolean) => "rounded-full border px-2 py-0.5 text-[11px] " + (on ? "border-[var(--accent)] text-text-primary" : "border-subtle text-text-muted hover:text-text-primary");

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50" onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && e.ctrlKey) void submit(); }}>
      <div className="glass flex max-h-[90vh] w-[720px] max-w-[calc(100vw-32px)] flex-col rounded-xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-text-primary">Create {host?.noun ?? "pull request"}</h3>
          <button onClick={onClose} className="vscode-toggle ml-auto" title="Close"><X size={14} /></button>
        </div>
        <div className="mt-1 text-[12px] text-text-muted">
          <span className="font-mono text-text-secondary">{head}</span> into{" "}
          <select value={base} onChange={(e) => { setBase(e.target.value); }} className="vscode-input px-1.5 py-0.5 text-[12px]">
            {!branches.includes(base) && base && <option value={base}>{base}</option>}
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {gh === false && <span className="ml-2">· {host?.kind === "gitlab" ? "glab" : "gh"} not available: the host's page will open to finish it</span>}
        </div>

        <div className="scroll-thin mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <input value={title} onChange={(e) => { setTitle(e.target.value); setTouched(true); }} placeholder="Title" autoFocus
            className="vscode-input w-full px-2.5 py-1.5 text-[13px]" />
          <textarea value={body} onChange={(e) => { setBody(e.target.value); setTouched(true); }} placeholder="Description"
            // Tall by default: a PR description is often a template with several sections.
            className="vscode-input h-[45vh] min-h-32 w-full resize-y px-2.5 py-1.5 font-mono text-[12px]" />

          {gh && (meta?.people.length ?? 0) > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Reviewers {reviewers.length > 0 && <span className="normal-case text-text-secondary">· {reviewers.join(", ")}</span>}
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter"
                  className="vscode-input ml-auto w-32 px-2 py-0.5 text-[11px] normal-case" />
              </div>
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                {people.map((u) => (
                  <button key={u.login} onClick={() => toggle(reviewers, setReviewers, u.login)} className={chip(reviewers.includes(u.login))} title={u.name || u.login}>
                    {u.login}
                  </button>
                ))}
              </div>
            </div>
          )}
          {gh && (meta?.labels.length ?? 0) > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Labels</div>
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                {meta!.labels.map((l) => (
                  <button key={l.name} onClick={() => toggle(labels, setLabels, l.name)} className={chip(labels.includes(l.name))}
                    style={l.color ? { borderLeft: `3px solid #${l.color}` } : undefined}>
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 text-[12px] text-text-secondary">
          {gh !== false && (
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Draft</label>
          )}
          {gh !== false && (
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} /> Open in browser after</label>
          )}
          <button onClick={() => void submit()} disabled={busy || !title.trim() || !base || gh === null}
            className="ml-auto flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }} title="Ctrl+Enter">
            {busy && <Loader2 size={13} className="animate-spin" />}
            {gh === false ? "Push and open in browser" : "Push and create"}
          </button>
        </div>
      </div>
    </div>
  );
}
