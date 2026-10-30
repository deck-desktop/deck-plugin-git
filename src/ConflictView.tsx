// A conflicted file resolved here, in the Git pane, rather than in the editor: each block a merge,
// rebase or cherry-pick left in it, the current change beside the incoming one, with buttons to keep
// either or both. A choice writes the file at once. When no block is left, Mark as Resolved stages
// it; the whole file can also be taken from either side.
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { fsRead, fsWrite, type GitStatusRow } from "../shim/bridge.js";
import type { ConfirmState } from "../shim/ui.js";
import { findConflicts, resolveBlock, sides, type ConflictBlock, type ConflictPick } from "./conflicts";
import { gitStage, gitTakeSide } from "./git";
import { GIT_CHANGED } from "./WorkPanel";
import { accentFill, primaryBtn, secondaryBtn } from "./util";

/** The lines shown above a block, so it can be placed in the file. */
const CONTEXT = 3;
const tint = { current: "63, 185, 80", incoming: "79, 140, 255" } as const;

function Side({ kind, label, lines }: { kind: "current" | "incoming"; label: string; lines: string[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-subtle" style={{ background: `rgba(${tint[kind]}, 0.08)` }}>
      <div className="flex h-7 items-center gap-1.5 px-2.5 text-[11.5px] font-medium" style={{ background: `rgba(${tint[kind]}, 0.18)` }}>
        <span className="text-text-primary">{kind === "current" ? "Current change" : "Incoming change"}</span>
        {label && <span className="min-w-0 truncate font-normal text-text-muted">{label}</span>}
      </div>
      <pre className="scroll-thin overflow-x-auto px-2.5 py-1.5 font-mono text-[12px] leading-5 text-text-primary">
        {lines.length ? lines.join("\n") : <span className="italic text-text-muted">(nothing: this side removed these lines)</span>}
      </pre>
    </div>
  );
}

export function ConflictView({ root, row, onConfirm, onResolved }: {
  root: string;
  row: GitStatusRow;
  onConfirm: (s: ConfirmState) => void;
  /** After it is staged, by Mark as Resolved or by taking the whole file from one side. */
  onResolved: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    void fsRead(row.path).then(setText, (e) => { console.warn("[git] reading the conflicted file failed", e); setText(""); });
  }, [row.path]);
  if (text === null) return null;

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const blocks = findConflicts(lines);
  const changed = () => window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root }));
  const fail = (what: string) => (e: unknown) => {
    console.warn(`[git] ${what} failed`, e);
    onConfirm({ title: `${what} failed`, confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {}, body: String(e).replace(/^Error:\s*/, "") });
  };
  const pick = (b: ConflictBlock, p: ConflictPick) => {
    const next = resolveBlock(lines, b, p).join(eol);
    void fsWrite(row.path, next).then(() => { setText(next); changed(); }, fail("Saving the file"));
  };
  const whole = (side: "ours" | "theirs") => void gitTakeSide(root, [row.rel], side).then(() => { changed(); onResolved(); }, fail("Taking one side"));
  const resolve = () => void gitStage(root, [row.rel]).then(() => { changed(); onResolved(); }, fail("Marking it resolved"));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-3 py-2 text-[12.5px]">
        <span className="min-w-0 flex-1 text-text-secondary">
          {blocks.length ? `${blocks.length} conflict${blocks.length === 1 ? "" : "s"} left. Keep a side of each, or take the whole file from one.`
            : "Every conflict here is resolved. Mark it resolved to stage it."}
        </span>
        <button onClick={() => whole("ours")} className={secondaryBtn}>Take all current</button>
        <button onClick={() => whole("theirs")} className={secondaryBtn}>Take all incoming</button>
        <button onClick={resolve} disabled={blocks.length > 0} title={blocks.length ? "Resolve every conflict first" : "Stage the file"}
          className={primaryBtn} style={accentFill}><Check size={14} /> Mark as Resolved</button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {blocks.map((b) => {
          const s = sides(lines, b);
          const above = lines.slice(Math.max(0, b.start - 1 - CONTEXT), b.start - 1);
          return (
            <div key={b.start} className="space-y-1.5">
              <div className="text-[11.5px] text-text-muted">Line {b.start}</div>
              {above.length > 0 && <pre className="overflow-x-auto px-2.5 font-mono text-[12px] leading-5 text-text-muted">{above.join("\n")}</pre>}
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Side kind="current" label={b.current} lines={s.current} />
                <Side kind="incoming" label={b.incoming} lines={s.incoming} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => pick(b, "current")} className={secondaryBtn}>Accept current</button>
                <button onClick={() => pick(b, "incoming")} className={secondaryBtn}>Accept incoming</button>
                <button onClick={() => pick(b, "both")} className={secondaryBtn}>Accept both</button>
              </div>
            </div>
          );
        })}
        {!blocks.length && (
          <pre className="scroll-thin overflow-x-auto rounded-lg border border-subtle bg-elev px-3 py-2 font-mono text-[12px] leading-5 text-text-secondary">{text}</pre>
        )}
      </div>
    </div>
  );
}
