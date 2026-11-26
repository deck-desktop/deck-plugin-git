// The column beside a pull request's description: what decides whether it can merge (review,
// checks, conflicts, draft), each check, who reviews it, and its labels.
import { openExternal } from "../../shim/bridge.js";
import { heading, chipTone } from "../util";
import { mergeBlocker, type PrDetail } from "../prs";
import { STATE_COLOR, TONE } from "./common";
import { readiness, reviewers } from "./status";

export function PrSide({ d }: { d: PrDetail }) {
  const blocker = d.state === "OPEN" ? mergeBlocker(d) : null;
  const people = reviewers(d);
  const title = d.state === "MERGED" ? "Merged" : d.state === "CLOSED" ? "Closed" : blocker ? "Cannot merge yet" : "Before it can merge";
  return (
    <aside className="flex flex-col gap-5" style={{ flex: "1 1 260px", maxWidth: 320 }}>
      {d.state === "OPEN" && (
        <section className="rounded-lg border border-subtle bg-panel p-3">
          <h4 className={heading + " mb-1.5"}>{title}</h4>
          {readiness(d).map((r) => (
            <div key={r.label} className="flex h-7 items-center gap-2.5 text-[12.5px]">
              <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE[r.tone] }} />
              <span className="flex-1 text-text-secondary">{r.label}</span>
              <span className="min-w-0 truncate text-[11.5px] text-text-muted" title={r.value}>{r.value}</span>
            </div>
          ))}
          {blocker && <p className="mt-2 rounded-md px-2.5 py-2 text-[12px]" style={{ ...chipTone(TONE.bad), lineHeight: "18px" }}>{blocker}</p>}
        </section>
      )}

      {d.checks.length > 0 && (
        <section>
          <h4 className={heading + " mb-1"}>Checks</h4>
          {d.checks.map((c, i) => (
            <div key={i} className="flex h-6 items-center gap-2 text-[12px]">
              <span className="size-[7px] shrink-0 rounded-full" style={{ background: STATE_COLOR[c.state] }} />
              <span className="min-w-0 flex-1 truncate text-text-secondary" title={c.name}>{c.name}</span>
              {c.url && <button onClick={() => void openExternal(c.url)} className="text-[11px] text-[var(--accent)] hover:underline">details</button>}
            </div>
          ))}
        </section>
      )}

      {people.length > 0 && (
        <section>
          <h4 className={heading + " mb-1"}>Reviewers</h4>
          {people.map((p) => (
            <div key={p.name} className="flex h-7 items-center gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-text-secondary">{p.name}</span>
              <span className="shrink-0 rounded-full px-1.5 py-px text-[10.5px]" style={chipTone(TONE[p.tone])}>{p.verdict}</span>
            </div>
          ))}
        </section>
      )}

      {d.labels.length > 0 && (
        <section>
          <h4 className={heading + " mb-1.5"}>Labels</h4>
          <div className="flex flex-wrap gap-1.5">
            {d.labels.map((l) => (
              <span key={l.name} className="rounded-full px-2 py-px text-[11px]" style={chipTone(l.color ? `#${l.color.replace(/^#/, "")}` : "var(--text-secondary)")}>{l.name}</span>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
