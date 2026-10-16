// Keeping the Git tab current while something else changes the repo: an agent or a command in a
// terminal fires nothing Deck hears, so the graph and the uncommitted changes stayed as they were
// until the tab was switched away and back.
//
// While the graph is on screen, ask git every few seconds for one line per thing that can move
// (HEAD's commit, the branch, ahead/behind, each changed file: `status --porcelain=v2 -b`), and
// re-read only when that answer changes, through GIT_CHANGED like the plugin's own actions.
//
// Only while it can be seen (rule 11): a tab not showing is unmounted, which ends this; a graph
// mounted but off screen (a zone of the board not in view) or in a hidden window asks nothing.
import { useEffect, useRef } from "react";
import { gitRun } from "../shim/bridge.js";
import { GIT_CHANGED } from "./WorkPanel";

const EVERY_MS = 3000;

/** The repo's state as one string; equal strings mean nothing moved. */
export const repoSignature = (root: string) =>
  // --no-optional-locks: a read must not take .git/index.lock, or an agent's own git command
  // running at the same moment fails on it.
  gitRun(root, ["--no-optional-locks", "status", "--porcelain=v2", "-b"]);

/**
 * Re-read the repo when it changes outside Deck. `onScreen` is the graph's own on-screen flag (its
 * IntersectionObserver). The returned check is for the moment it comes into view: call it then to
 * catch up at once rather than on the next tick.
 */
export function useRepoWatch(root: string, onScreen: { readonly current: boolean }) {
  const check = useRef<() => void>(() => {});
  useEffect(() => {
    if (!root) return;
    let last: string | null = null;
    let busy = false;
    let stopped = false;
    let reporting = false;
    const tick = async () => {
      if (stopped || busy || document.hidden || !onScreen.current) return;
      busy = true;
      try {
        const sig = await repoSignature(root);
        if (stopped) return;
        const moved = last !== null && sig !== last;
        last = sig;
        if (moved) {
          reporting = true; // our own event: `own` below must not take it for an action's
          window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root }));
          reporting = false;
        }
      } catch {
        // Not a repo right now (deleted, mid-clone) or git not answering: the next tick asks again.
      } finally {
        busy = false;
      }
    };
    check.current = () => void tick();
    // The plugin's own action already re-read, so its result is the new baseline: taken now, so the
    // next tick does not report it again. Taken rather than skipping that tick, which would also
    // swallow anything else that changed before it.
    const own = (e: Event) => {
      if (reporting || (e as CustomEvent<string>).detail !== root) return;
      void repoSignature(root).then((sig) => { if (!stopped) last = sig; }, () => {});
    };
    const shown = () => { if (!document.hidden) void tick(); };
    void tick();
    const id = setInterval(() => void tick(), EVERY_MS);
    window.addEventListener(GIT_CHANGED, own);
    document.addEventListener("visibilitychange", shown);
    return () => {
      stopped = true;
      check.current = () => {};
      clearInterval(id);
      window.removeEventListener(GIT_CHANGED, own);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [root, onScreen]);
  return check;
}
