// A commit Deck asked the Git tab to show, kept until a pane takes it.
//
// Deck opens (or focuses) the Git tab and then fires the request, so the pane that should answer
// may not be mounted yet. The listener lives at module scope and keeps the request here; a pane
// takes it when it mounts, or at once if it is already showing.
export interface CommitRequest { hash: string; root: string }

let pending: CommitRequest | null = null;
const subs = new Set<() => void>();

const onShow = (e: Event) => {
  const d = (e as CustomEvent<CommitRequest>).detail;
  if (!d?.hash) return;
  pending = { hash: d.hash, root: d.root ?? "" };
  subs.forEach((f) => f());
};
// The event name is Deck's (core/gitopen.ts, GIT_SHOW_COMMIT).
window.addEventListener("deck-git-show-commit", onShow);
export const stopListening = () => window.removeEventListener("deck-git-show-commit", onShow);

export const subscribePending = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getPending = () => pending;
/** Take the request, so a second pane does not act on it too. */
export const takePending = () => { const p = pending; pending = null; return p; };
