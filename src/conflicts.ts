// Merge conflict blocks in a file's lines, and the lines with one resolved: what the conflict view
// (ConflictView.tsx) shows and writes. Pure, with a check beside it.
//
//   <<<<<<< HEAD          the current change (this branch)
//   ...
//   ||||||| base          only with merge.conflictStyle diff3/zdiff3: the common ancestor
//   ...
//   =======
//   ...                   the incoming change
//   >>>>>>> other

/** One block, by the 1-based line numbers of its markers, and the labels git wrote on them. */
export interface ConflictBlock {
  start: number;
  /** The `|||||||` line of a diff3 block, else null. */
  base: number | null;
  mid: number;
  end: number;
  current: string;
  incoming: string;
}
export type ConflictPick = "current" | "incoming" | "both";

// Git writes exactly seven, then a space and a label, or nothing.
const START = /^<{7}(?: |\r?$)/, BASE = /^\|{7}(?: |\r?$)/, MID = /^={7}\r?$/, END = /^>{7}(?: |\r?$)/;
const label = (l: string) => l.slice(7).trim();

/** Every complete block, in order. A block left unclosed is not one. */
export function findConflicts(lines: string[]): ConflictBlock[] {
  const out: ConflictBlock[] = [];
  let open: { start: number; base: number | null; mid: number; current: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], n = i + 1;
    // A start inside a block starts over: the earlier one was never closed.
    if (START.test(l)) open = { start: n, base: null, mid: 0, current: label(l) };
    else if (!open) continue;
    else if (!open.mid && open.base === null && BASE.test(l)) open.base = n;
    else if (!open.mid && MID.test(l)) open.mid = n;
    else if (open.mid && END.test(l)) { out.push({ ...open, end: n, incoming: label(l) }); open = null; }
  }
  return out;
}

/** Each side's lines. The base (diff3) is in neither. */
export const sides = (lines: string[], b: ConflictBlock) => ({
  current: lines.slice(b.start, (b.base ?? b.mid) - 1),
  incoming: lines.slice(b.mid, b.end - 1),
});

/** The file's lines with block `b` replaced by one side, or both with the current change first. */
export function resolveBlock(lines: string[], b: ConflictBlock, pick: ConflictPick): string[] {
  const s = sides(lines, b);
  const keep = pick === "current" ? s.current : pick === "incoming" ? s.incoming : [...s.current, ...s.incoming];
  return [...lines.slice(0, b.start - 1), ...keep, ...lines.slice(b.end)];
}
