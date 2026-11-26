// A pull request's actions, at the right of its header: one filled button for what it waits for
// (Approve, Merge, Mark ready, Reopen), Check out beside it, and the rest under ⋯. Approve and Merge
// open their own small box under the header rather than acting: review and merge are said, then sent.
import { useState, type ReactNode } from "react";
import { Loader2, GitMerge, LogIn, MoreHorizontal, Check, AlertTriangle, ExternalLink, Link2, X, CircleDot } from "lucide-react";
import { openExternal } from "../../shim/bridge.js";
import { ContextMenu, Segmented, type MenuEntry } from "../../shim/ui.js";
import { field, secondaryBtn, dangerSecondaryBtn, primaryBtn, accentFill, toggledOn } from "../util";
import { mergeBlocker, type PrDetail } from "../prs";
import type { PrHost, Verdict, MergeMethod } from "../prhost";
import { TONE } from "./common";
import type { Primary } from "./status";

type Box = null | "review" | "merge" | "close";

export function PrActions({ d, host, primary, verdicts, busy, run }: {
  d: PrDetail; host: PrHost; primary: Primary;
  verdicts: { v: Verdict; label: string; why?: string }[];
  busy: string;
  /** A host action, then everything re-read; `repoMoved` when the repo itself changed. */
  run: (label: string, act: () => Promise<unknown>, repoMoved?: boolean) => Promise<boolean>;
}) {
  const n = d.number;
  const open = d.state === "OPEN";
  const [box, setBox] = useState<Box>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const offered = verdicts.filter((x) => !x.why);
  const refused = verdicts.find((x) => x.why)?.why;
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const chosen = verdict && offered.some((x) => x.v === verdict) ? verdict : offered[0]?.v ?? "comment";
  const [method, setMethod] = useState<MergeMethod>("merge");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const blocker = mergeBlocker(d);
  const failing = d.checks.filter((c) => c.state === "failing");

  const toggle = (b: Box) => { setBox(box === b ? null : b); setText(""); };
  const send = (label: string, act: () => Promise<unknown>, repoMoved = false) =>
    void run(label, act, repoMoved).then((ok) => { if (ok) { setBox(null); setText(""); } });

  const items: MenuEntry[] = [
    ...(open && primary !== "approve" ? [{ label: "Review…", icon: Check, onClick: () => toggle("review") }] : []),
    ...(open && primary !== "merge" && primary !== "blocked" ? [{ label: "Merge…", icon: GitMerge, onClick: () => toggle("merge") }] : []),
    ...(open && primary !== "ready"
      ? [{ label: d.isDraft ? "Mark ready for review" : "Convert to draft", onClick: () => void run(d.isDraft ? "Mark ready" : "Convert to draft", () => host.setDraft(n, !d.isDraft)) }]
      : []),
    { label: "Copy link", icon: Link2, onClick: () => void navigator.clipboard.writeText(d.url).catch((e) => console.warn("[git] copying the link failed", e)) },
    { label: `Open in ${host.name}`, icon: ExternalLink, onClick: () => void openExternal(d.url) },
    ...(open ? ["sep" as const, { label: `Close ${host.noun}…`, icon: X, danger: true, onClick: () => toggle("close") }] : []),
  ];

  /** The open action's own small form, on a line of its own under the header. */
  const card = "space-y-2.5 rounded-lg border border-subtle p-3 text-[12px] text-text-secondary";
  const under = (body: ReactNode) => <div className="basis-full"><div className={card} style={{ background: "var(--bg-card)", maxWidth: 560 }}>{body}</div></div>;

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        {busy && <span className="flex items-center gap-1 text-[11px] text-text-muted"><Loader2 size={12} className="animate-spin" /> {busy}…</span>}
        {open && (
          <button disabled={!!busy} onClick={() => void run("Check out", () => host.checkout(n), true)} className={secondaryBtn} title={`Check out the ${host.noun}'s branch here, to run it`}>
            <LogIn size={13} /> Check out
          </button>
        )}
        {primary === "approve" && <button disabled={!!busy} onClick={() => toggle("review")} className={primaryBtn} style={accentFill}>Approve</button>}
        {primary === "merge" && <button disabled={!!busy} onClick={() => toggle("merge")} className={primaryBtn} style={accentFill}><GitMerge size={13} /> Merge</button>}
        {primary === "ready" && <button disabled={!!busy} onClick={() => void run("Mark ready", () => host.setDraft(n, false))} className={primaryBtn} style={accentFill}>Mark ready for review</button>}
        {primary === "reopen" && <button disabled={!!busy} onClick={() => void run("Reopen", () => host.reopen(n))} className={primaryBtn} style={accentFill}><CircleDot size={13} /> Reopen</button>}
        {/* Nothing to fill when something is in the way: what it is, where the button would be. */}
        {primary === "blocked" && (
          <button onClick={() => toggle("merge")} className={secondaryBtn} style={{ color: TONE.bad }} title="What keeps it from merging">
            <AlertTriangle size={13} /> Can't merge yet
          </button>
        )}
        <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom + 4 }); }}
          title="More actions" aria-label="More actions" className={secondaryBtn + " w-8 px-0"} style={menu ? toggledOn : undefined}>
          <MoreHorizontal size={15} />
        </button>
        {menu && <ContextMenu x={menu.x} y={menu.y} alignRight items={items} onClose={() => setMenu(null)} />}
      </div>

      {box === "review" && under(<>
          {offered.length > 1 && <Segmented value={chosen} onChange={setVerdict} options={offered.map((x) => ({ value: x.v, label: x.label }))} layoutId={`pr-verdict-${n}`} />}
          {refused && <p className="text-[11.5px] text-text-muted">{refused}, so only a comment is possible here. Another account can approve it.</p>}
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
            placeholder={chosen === "approve" || chosen === "revoke" ? "Optional message" : chosen === "comment" ? "Comment (required)" : "What should change? (required)"}
            className={field + " block resize-y px-2.5 py-1.5 leading-5"} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setBox(null)} className={secondaryBtn}>Cancel</button>
            <button disabled={!!busy || ((chosen === "comment" || chosen === "request-changes") && !text.trim())}
              onClick={() => send("Review", () => host.review(n, chosen, text.trim()))} className={primaryBtn} style={accentFill}>
              {offered.find((x) => x.v === chosen)?.label ?? "Submit review"}
            </button>
          </div>
        </>)}

      {box === "merge" && under(blocker ? (
        // What is in the way, with where to see more; no merge button to guess at.
        <div className="space-y-2">
          <Reason text={blocker} />
          {failing.map((c, i) => <Reason key={i} text={`Check failed: ${c.name}.`} link={c.url ? { label: "See its log", onClick: () => void openExternal(c.url) } : undefined} />)}
        </div>
      ) : (
        <>
          {failing.map((c, i) => <Reason key={i} tone="wait" text={`Check failed: ${c.name}. It can still be merged.`} link={c.url ? { label: "See its log", onClick: () => void openExternal(c.url) } : undefined} />)}
          <div className="flex items-center gap-2">
            <label htmlFor={`pr-method-${n}`} className="text-text-muted">As</label>
            <select id={`pr-method-${n}`} value={method} onChange={(e) => setMethod(e.target.value as MergeMethod)} className={field + " h-7 px-2"} style={{ width: "auto" }}>
              <option value="merge">a merge commit</option>
              <option value="squash">one squashed commit</option>
              <option value="rebase">rebased commits</option>
            </select>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--accent)]" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} /> Delete <span className="font-mono text-[11.5px]">{d.head}</span> after merging</label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setBox(null)} className={secondaryBtn}>Cancel</button>
            <button disabled={!!busy} onClick={() => send("Merge", () => host.merge(n, method, deleteBranch), true)} className={primaryBtn} style={accentFill}>
              <GitMerge size={13} /> Merge into {d.base}
            </button>
          </div>
        </>
      ))}

      {box === "close" && under(<>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Why it is being closed (optional, posted as a comment)"
            className={field + " block resize-y px-2.5 py-1.5 leading-5"} />
          {/* It can be reopened, so it asks nothing more; red only under the pointer. */}
          <div className="flex justify-end gap-2">
            <button onClick={() => setBox(null)} className={secondaryBtn}>Cancel</button>
            <button disabled={!!busy} onClick={() => send("Close", () => host.close(n, text.trim()))} className={dangerSecondaryBtn}>Close {host.noun}</button>
          </div>
        </>)}
    </>
  );
}

/** One thing in the way of the merge, with where to see more. */
function Reason({ text, link, tone = "bad" }: { text: string; link?: { label: string; onClick: () => void }; tone?: "bad" | "wait" }) {
  return (
    <div className="flex gap-2" style={{ lineHeight: "18px" }}>
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE[tone], marginTop: 6 }} />
      <span className="flex-1">
        <span className="text-text-primary">{text}</span>
        {link && <> <button onClick={link.onClick} className="text-[var(--accent)] hover:underline">{link.label}</button></>}
      </span>
    </div>
  );
}
