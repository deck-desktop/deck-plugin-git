// What the Git plugin tells the user through Deck's notifications, so Settings › Notifications
// decides where each goes. An action's result is a card that goes by itself and is not kept in the
// bell. One that talks to a remote (push, pull) shows a card while it runs, which its result
// replaces; if it fails, an error card takes its place and is kept, since such an action is the
// one left running while you look elsewhere, where its pane's own message would be missed.
import { notify } from "../shim/ui.js";

const source = "Git";
let seq = 0;

export interface Told { title: string; body?: string }

/** A failure for the user, kept in the bell. */
export const failure = (title: string, body?: string) => void notify({ kind: "error", source, title, body });

/** git's own words for what went wrong: its fatal or error line, else its first. */
const why = (e: unknown) => {
  const lines = String(e).replace(/^Error:\s*/, "").split(/\r?\n/).filter((l) => l.trim());
  return lines.find((l) => /fatal|error|rejected/i.test(l)) ?? lines[0] ?? "";
};

/** Run `run`; tell the user what it did once it is done, and what it is doing meanwhile when it says. */
export async function told<T>(run: () => Promise<T>, done: (out: T) => Told, doing?: Told): Promise<T> {
  const key = `op-${++seq}`;
  if (doing) notify({ kind: "activity", source, key, transient: true, ...doing });
  try {
    const out = await run();
    notify({ kind: "activity", source, key, transient: true, ...done(out) });
    return out;
  } catch (e) {
    if (doing) notify({ kind: "error", source, key, title: `${doing.title.replace(/…$/, "")} failed`, body: `${doing.body ? `${doing.body}: ` : ""}${why(e)}` });
    throw e;
  }
}

/** The folder's name, which says which repository a card is about. */
export const repoName = (dir: string) => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;
/** A commit as people read it: seven characters of a hash, a branch or tag name as it is. */
export const short = (rev: string) => (/^[0-9a-f]{40}$/i.test(rev) ? rev.slice(0, 7) : rev);
