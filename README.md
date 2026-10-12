# Git for Deck

A commit graph for each workspace, in a pane. Open it from the **+** beside your tabs and choose
**Git**.

- **Graph** of every branch, with search (Ctrl+F, or / while the list has focus), n and Shift+N
  between matches, h to jump to HEAD, Enter to show a commit.
- **Uncommitted changes**: stage and unstage files, commit, amend, push.
- **Branches, tags and stashes** from the graph's context menu: checkout, create, merge, rebase,
  reset, cherry-pick, revert, apply a stash.
- **File history**: one file's commits, following renames.
- **Diffs** for every change, side by side or inline, images included.
- **Pull requests** on GitHub (`gh`) and GitLab (`glab`): list, review the diff, comment on a line,
  reply, resolve, merge.
- A folder with several repositories gets a picker.
- "Open in editor" on a file opens it in Deck's Editor.

Clicking the commit hash in the Editor's status bar (the blame of the current line) opens this
tab on that commit.

Git was Deck's built-in Git Graph until 1.1. It stores nothing of its own: everything it shows is
read from your repositories.
