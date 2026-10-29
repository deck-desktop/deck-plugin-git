// What the Git plugin tells the user through Deck's notifications, so Settings › Notifications
// decides where each goes. An action's result is a card that goes by itself and is not kept in the
// bell. One that talks to a remote (push, pull) shows a card while it runs, which its result
// replaces, and which goes if it fails: the failure is shown where the action was asked for.
import { dismissNotification, notify } from "../shim/ui.js";

const source = "Git";
let seq = 0;

export interface Told { title: string; body?: string }

/** Run `run`; tell the user what it did once it is done, and what it is doing meanwhile when it says. */
export async function told<T>(run: () => Promise<T>, done: (out: T) => Told, doing?: Told): Promise<T> {
  const key = `op-${++seq}`;
  if (doing) notify({ kind: "activity", source, key, transient: true, ...doing });
  try {
    const out = await run();
    notify({ kind: "activity", source, key, transient: true, ...done(out) });
    return out;
  } catch (e) {
    if (doing) dismissNotification(source, key);
    throw e;
  }
}

/** The folder's name, which says which repository a card is about. */
export const repoName = (dir: string) => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;
/** A commit as people read it: seven characters of a hash, a branch or tag name as it is. */
export const short = (rev: string) => (/^[0-9a-f]{40}$/i.test(rev) ? rev.slice(0, 7) : rev);
