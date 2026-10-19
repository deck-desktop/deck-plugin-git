// Git: the commit graph, staging and committing, branches, stashes and pull requests, in a pane.
// It was Deck's built-in Git Graph until 1.1.
//
// Deck keeps what the Editor shows about git (the branch picker, gutter change markers, the blame
// hash and the file tree's colours); this plugin is where git is worked with. The Editor's blame
// hash asks for a commit through deck-git-show-commit (see pending.ts), and "open in editor" here
// goes back through deck-term-open, so the two stay connected without importing each other.
import GraphPane from "./GraphPane";
import { stopListening } from "./pending";

export const PaneView = ({ cwd }: { cwd: string }) => <GraphPane cwd={cwd} />;

// Defaults only; a rebinding in Settings > Keybindings wins. Search answers whenever a graph is on
// screen, the rest only while the commit list has focus (see GitGraph.tsx).
export const keybindings = () => [
  { id: "show", title: "Show the selected commit", defaultChord: "enter" },
  { id: "escape", title: "Clear the search, or the selection", defaultChord: "escape" },
  { id: "search", title: "Search commits", defaultChord: "ctrl+f" },
  { id: "search-alt", title: "Search commits (alternate)", defaultChord: "/" },
  { id: "next-match", title: "Next search match", defaultChord: "n" },
  { id: "prev-match", title: "Previous search match", defaultChord: "shift+n" },
  { id: "head", title: "Jump to HEAD", defaultChord: "h" },
  { id: "undo", title: "Undo the last change", defaultChord: "ctrl+z" },
];

export function dispose() { stopListening(); }
