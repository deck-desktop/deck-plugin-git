// Small values the shims cannot carry: the ui shim forwards Deck's functions, not its constants.

/** The last segment of a path (Deck's editor/tree.ts has the same one-liner). */
export const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** The graph's Ctrl+wheel font sizes, as core/editorsettings.ts lists them for the setting. */
export const GRAPH_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20];
