// A pull request's commits, drawn as the graph draws a branch: one lane in the graph's first
// colour, each commit its author's picture on it, then the message, the date and the short hash,
// newest at the top, at the graph's font size.
import { useEditorSettings } from "../../shim/ui.js";
import { AvatarNode } from "../avatar";
import { COLORS } from "../GitGraph";
import type { PrCommit } from "../prs";

// The graph's row: 16px between lanes, 28px tall, at the 13px design size zoomed to the setting.
const W = 16, H = 28;
const day = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };

export function PrCommits({ root, commits, onOpen }: { root: string; commits: PrCommit[]; onOpen?: (oid: string) => void }) {
  const { graphFontSize } = useEditorSettings();
  const S = graphFontSize / 13;
  const color = COLORS[0];
  const rows = [...commits].reverse();
  return (
    <div className="scroll-thin h-full overflow-y-auto py-1.5">
      {rows.map((c, i) => (
        <div key={c.oid} style={S === 1 ? undefined : { zoom: S }}>
          <button onClick={() => onOpen?.(c.oid)} title={`${c.headline}\n${c.author}`}
            className="flex h-[28px] w-full items-center gap-2 px-2 text-left transition-colors hover:bg-white/5">
            <svg width={W * 2} height={H} className="shrink-0" style={{ display: "block" }} aria-hidden>
              {/* The lane runs on to the commits above and below, not past the first and last. */}
              <line x1={W} x2={W} y1={i === 0 ? H / 2 : 0} y2={i === rows.length - 1 ? H / 2 : H} stroke={color} strokeWidth={1.5} />
              <AvatarNode root={root} x={W} y={H / 2} ring={color} name={c.author} email={c.email ?? ""} />
            </svg>
            <span className="min-w-0 flex-1 truncate text-text-primary">{c.headline}</span>
            <span className="w-28 shrink-0 truncate text-right text-[11px] text-text-muted">{c.author}</span>
            <span className="w-20 shrink-0 text-right text-[11px] text-text-muted">{day(c.at)}</span>
            <span className="w-16 shrink-0 text-right font-mono text-[11px] text-text-muted">{c.oid.slice(0, 7)}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
