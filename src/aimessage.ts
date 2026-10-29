// The AI commit message while it is being written, per repository and outside the panel: going to
// another tab neither stops it nor loses it. When it arrives it is put into the repository's draft
// (`land`), and the panel, there or back by then, reads the draft again on the version moving. A
// failure is a notification, there being no panel for certain to show it in.
import { useSyncExternalStore } from "react";
import { failure } from "./notice";

const writing = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => { version++; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Ask for a message for `root` unless one is already being written; `land` puts it in the draft. */
export function writeMessage(root: string, ask: () => Promise<string>, land: (message: string) => void) {
  if (writing.has(root)) return;
  writing.add(root);
  emit();
  ask()
    .then((m) => { if (m.trim()) land(m); })
    .catch((e) => failure("Could not write a commit message", String(e).replace(/^Error:\s*/, "")))
    .finally(() => { writing.delete(root); emit(); });
}

/** Whether a message for `root` is being written. */
export const useWriting = (root: string) => useSyncExternalStore(subscribe, () => writing.has(root));
/** Moves when one starts or lands: the panel reads its draft again. */
export const useMessageVersion = () => useSyncExternalStore(subscribe, () => version);
