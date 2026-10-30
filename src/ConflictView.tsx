// A conflicted file resolved here, in the Git pane, rather than in the editor tab: the whole file in a
// code editor, each block a merge, rebase or cherry-pick left in it tinted, with Deck's Accept
// Current / Incoming / Both buttons over it (Deck's conflict lens, which every file model gets). The
// file is written as it changes. When no block is left, Mark as Resolved stages it; the whole file
// can also be taken from either side. Side by side adds both sides' whole files above it (ConflictSides).
import { useEffect, useRef, useState } from "react";
import { Check, Columns2, Rows2 } from "lucide-react";
import { fsRead, fsWrite, type GitStatusRow } from "../shim/bridge.js";
import { monaco } from "../shim/monaco.js";
import { monacoOptionsFrom, useEditorSettings, useResize, type ConfirmState } from "../shim/ui.js";
import { findConflicts } from "./conflicts";
import { ConflictSides } from "./ConflictSides";
import { gitStage, gitTakeSide } from "./git";
import { GIT_CHANGED } from "./WorkPanel";
import { accentFill, primaryBtn, secondaryBtn } from "./util";

/** How long after the last edit the file is written. */
const SAVE_MS = 250;
const SPLIT_KEY = "deck-git-conflict-split";
const loadSplit = () => { try { return localStorage.getItem(SPLIT_KEY) === "1"; } catch { return false; } };
const saveSplit = (on: boolean) => { try { localStorage.setItem(SPLIT_KEY, on ? "1" : "0"); } catch { /* a preference only */ } };

export function ConflictView({ root, row, onConfirm, onResolved }: {
  root: string;
  row: GitStatusRow;
  onConfirm: (s: ConfirmState) => void;
  /** After it is staged, by Mark as Resolved or by taking the whole file from one side. */
  onResolved: () => void;
}) {
  const settings = useEditorSettings();
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<ReturnType<typeof monaco.editor.create> | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [model, setModel] = useState<ReturnType<typeof monaco.editor.createModel> | null>(null);
  const [split, setSplit] = useState(loadSplit);
  const [sidesH, sidesDrag] = useResize({ initial: 300, min: 120, max: 1400, direction: "vertical" });
  // The write waiting on SAVE_MS, run now by flush() and dropped by taking a whole side.
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => Promise<void> } | null>(null);

  const fail = (what: string) => (e: unknown) => {
    console.warn(`[git] ${what} failed`, e);
    onConfirm({ title: `${what} failed`, confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {}, body: String(e).replace(/^Error:\s*/, "") });
  };
  const changed = () => { window.dispatchEvent(new CustomEvent(GIT_CHANGED, { detail: root })); };
  const flush = async () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    await p.run();
  };

  useEffect(() => {
    let gone = false, cleanup = () => {};
    void fsRead(row.path).then((text) => {
      if (gone || !host.current) return;
      const uri = monaco.Uri.file(row.path);
      // The file may be open in an editor tab too: share its model, as Deck's own editors do.
      const shared = monaco.editor.getModel(uri);
      const model = shared ?? monaco.editor.createModel(text, undefined, uri);
      if (shared && shared.getValue() !== text) shared.setValue(text);
      const e = monaco.editor.create(host.current, { ...monacoOptionsFrom(settings), model, automaticLayout: true });
      ed.current = e;
      setModel(model);
      const count = () => findConflicts(model.getLinesContent()).length;
      setLeft(count());
      const first = findConflicts(model.getLinesContent())[0];
      if (first) e.revealLineInCenter(first.start);
      const sub = model.onDidChangeContent(() => {
        setLeft(count());
        if (pending.current) clearTimeout(pending.current.timer);
        const run = () => fsWrite(row.path, model.getValue()).then(changed, fail("Saving the file"));
        pending.current = { run, timer: setTimeout(() => { pending.current = null; void run(); }, SAVE_MS) };
      });
      cleanup = () => { sub.dispose(); e.dispose(); ed.current = null; setModel(null); if (!shared) model.dispose(); };
    }, fail("Reading the conflicted file"));
    return () => { gone = true; void flush(); cleanup(); };
    // Settings changes are applied below, without remaking the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.path]);
  useEffect(() => { ed.current?.updateOptions(monacoOptionsFrom(settings)); }, [settings]);

  const whole = (side: "ours" | "theirs") => {
    // The edits so far are dropped: the file is about to be replaced by one side.
    if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; }
    void gitTakeSide(root, [row.rel], side).then(() => { changed(); onResolved(); }, fail("Taking one side"));
  };
  const resolve = () => void flush().then(() => gitStage(root, [row.rel])).then(() => { changed(); onResolved(); }, fail("Marking it resolved"));
  const n = left ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-3 py-2 text-[12.5px]">
        <span className="min-w-0 flex-1 text-text-secondary">
          {left === null ? "" : n ? `${n} conflict${n === 1 ? "" : "s"} left. Pick a side over each block, or edit the file.`
            : "Every conflict here is resolved. Mark it resolved to stage it."}
        </span>
        <button onClick={() => { setSplit(!split); saveSplit(!split); }} title={split ? "Show the file only" : "Show both sides' files above it"}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary">
          {split ? <><Rows2 size={13} /> Inline</> : <><Columns2 size={13} /> Side by side</>}
        </button>
        <button onClick={() => whole("ours")} className={secondaryBtn}>Take all current</button>
        <button onClick={() => whole("theirs")} className={secondaryBtn}>Take all incoming</button>
        <button onClick={resolve} disabled={left === null || n > 0} title={n ? "Resolve every conflict first" : "Stage the file"}
          className={primaryBtn} style={accentFill}><Check size={14} /> Mark as Resolved</button>
      </div>
      {split && model && <div className="flex min-h-0 shrink-0 flex-col" style={{ height: sidesH }}><ConflictSides model={model} settings={settings} /></div>}
      {split && <>
        <div {...sidesDrag} title="Drag to resize" className="h-1.5 shrink-0 cursor-row-resize transition-colors hover:bg-[var(--accent)]" />
        <div className="flex h-7 shrink-0 items-center px-3 text-[11.5px] font-medium text-text-secondary">Result</div>
      </>}
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
