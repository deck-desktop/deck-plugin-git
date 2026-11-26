// What the pull request views share: the check-state colours, two small buttons, a short age, and
// a failure turned into the dialog that says what went wrong.
import type { ConfirmState } from "../../shim/ui.js";
import { failedDialog } from "../ErrorText";
import type { PrState } from "../prs";


export const STATE_COLOR: Record<PrState, string> = { passing: "rgb(var(--tone-green-400))", failing: "rgb(var(--tone-red-400))", pending: "rgb(var(--tone-amber-400))", none: "var(--text-muted)" };
/** A small secondary button, for actions inside a card (reply, resolve, cancel). */
export const smallBtn = "flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-subtle bg-elev px-2.5 text-[11.5px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary disabled:opacity-40";
/** The same, filled in the accent: the one thing a card is for. */
export const smallPrimary = "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium text-white transition-opacity hover:brightness-110 disabled:opacity-50";
export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return !isFinite(s) ? "" : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
export const failWith = (onConfirm: (s: ConfirmState) => void, root: string) => (title: string, e: unknown) => onConfirm(failedDialog(title, e, root));
