// Small values the shims cannot carry: the ui shim forwards Deck's functions, not its constants.

/** The last segment of a path (Deck's editor/tree.ts has the same one-liner). */
export const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** The graph's Ctrl+wheel font sizes, as core/editorsettings.ts lists them for the setting. */
export const GRAPH_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20];

// The class strings of Deck's own panels (the Editor's Source Control and Run and Debug), so this
// plugin's panels look like them; see Deck's docs/design.md.
/** An icon button inside a row. */
export const iconBtn = "grid size-5 place-items-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary";
/** The same, for an action that destroys work: red only on hover. */
export const dangerBtn = "grid size-5 place-items-center rounded text-text-muted transition-colors hover:bg-white/10 hover:text-red-400";
/** A toolbar's icon button. */
export const toolBtn = "grid size-7 shrink-0 place-items-center rounded-lg text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary disabled:opacity-40";
/** A text box on the elevated surface, lit in the accent while typing in it. */
export const field = "w-full rounded-lg border border-subtle bg-elev text-[12.5px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-[var(--accent)]";
/** A secondary button: everything beside the one primary action. */
export const secondaryBtn = "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-subtle bg-elev px-3 text-[12px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary disabled:opacity-40";
/** A secondary button for an action that cannot simply be taken back: red only on hover. Its own
 *  string, since a second hover colour appended to secondaryBtn loses to it by stylesheet order. */
export const dangerSecondaryBtn = "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-subtle bg-elev px-3 text-[12px] text-text-secondary transition-colors hover:border-strong hover:text-red-400 disabled:opacity-40";
/** The one primary action of a screen, filled in the accent (with `style={accentFill}`). */
export const primaryBtn = "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-white transition-opacity hover:brightness-110 disabled:opacity-50";
export const accentFill = { background: "var(--accent)" } as const;
/** A heading inside a panel: sentence case, never an uppercase label. */
export const heading = "text-[12px] font-medium text-text-secondary";
/** A toggle that is on: the accent's soft fill and a ring. */
export const toggledOn = { background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent)" } as const;
/** A status chip's colours: the text in the colour, the background the same at 14%. */
export const chipTone = (color: string) => ({ color, background: `color-mix(in srgb, ${color} 14%, transparent)` });
/** A count after a heading. */
export const countChip = "flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-elev px-1.5 text-[10.5px] text-text-secondary";
