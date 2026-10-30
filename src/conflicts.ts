// Merge conflict blocks in a file's lines: what the conflict view (ConflictView.tsx) counts. Pure,
// with a check beside it.
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


/** The file as one side has it: every block replaced by that side's lines, a diff3 base dropped. */
export function sideOf(lines: string[], side: "current" | "incoming"): string[] {
  const out: string[] = [];
  let i = 0;
  for (const b of findConflicts(lines)) {
    out.push(...lines.slice(i, b.start - 1));
    out.push(...(side === "current" ? lines.slice(b.start, (b.base ?? b.mid) - 1) : lines.slice(b.mid, b.end - 1)));
    i = b.end;
  }
  return [...out, ...lines.slice(i)];
}
