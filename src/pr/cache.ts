// What was last read of a repo's pull requests, kept for the session so that opening the list or a
// pull request again shows it at once while it is read afresh behind it. Outside React: the list and
// the view unmount whenever the panel closes.
import type { PrDetail, PrRow } from "../prs";
import type { Verdict } from "../prhost";

export interface Lists { all: PrRow[]; review: PrRow[] | null; mine: PrRow[] | null }
export type Verdicts = { v: Verdict; label: string; why?: string }[];

// ponytail: never evicted; one entry per repo and per pull request opened this session, small.
export const listCache = new Map<string, Lists>();
export const detailCache = new Map<string, PrDetail>();
export const verdictCache = new Map<string, Verdicts>();
export const prKey = (root: string, n: number) => `${root}#${n}`;
