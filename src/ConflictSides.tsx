// The conflict view's side-by-side half: the file as the current change has it beside the file as
// the incoming change has it, as a read-only diff, so what each side did is seen in full. It follows
// the result editor below it: a block resolved there is the same on both sides here.
import { useEffect, useRef, useState } from "react";
import { monaco } from "../shim/monaco.js";
import { monacoOptionsFrom, type EditorSettings } from "../shim/ui.js";
import { findConflicts, sideOf } from "./conflicts";

type Model = ReturnType<typeof monaco.editor.createModel>;

export function ConflictSides({ model, settings }: { model: Model; settings: EditorSettings }) {
  const host = useRef<HTMLDivElement>(null);
  const diff = useRef<ReturnType<typeof monaco.editor.createDiffEditor> | null>(null);
  // The labels git wrote on the markers (HEAD, the branch merged in), kept once every block is gone.
  const [labels, setLabels] = useState({ current: "", incoming: "" });

  useEffect(() => {
    if (!host.current) return;
    const lang = model.getLanguageId();
    const a = monaco.editor.createModel("", lang), b = monaco.editor.createModel("", lang);
    const d = monaco.editor.createDiffEditor(host.current, {
      ...monacoOptionsFrom(settings), readOnly: true, originalEditable: false, renderSideBySide: true,
      automaticLayout: true, renderOverviewRuler: false, minimap: { enabled: false },
    });
    d.setModel({ original: a, modified: b });
    diff.current = d;
    const sync = () => {
      const lines = model.getLinesContent(), eol = model.getEOL();
      a.setValue(sideOf(lines, "current").join(eol));
      b.setValue(sideOf(lines, "incoming").join(eol));
      const first = findConflicts(lines)[0];
      if (first) setLabels((l) => l.current === first.current && l.incoming === first.incoming ? l : { current: first.current, incoming: first.incoming });
    };
    sync();
    const sub = model.onDidChangeContent(sync);
    return () => { sub.dispose(); d.dispose(); a.dispose(); b.dispose(); diff.current = null; };
    // Settings changes are applied below, without remaking the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  useEffect(() => { diff.current?.updateOptions(monacoOptionsFrom(settings)); }, [settings]);

  const head = (kind: "current" | "incoming", label: string) => (
    <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 px-3 text-[11.5px] font-medium"
      style={{ background: kind === "current" ? "rgba(63, 185, 80, 0.16)" : "rgba(79, 140, 255, 0.16)" }}>
      <span className="text-text-primary">{kind === "current" ? "Current change" : "Incoming change"}</span>
      {label && <span className="min-w-0 truncate font-normal text-text-muted">{label}</span>}
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0">{head("current", labels.current)}{head("incoming", labels.incoming)}</div>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
