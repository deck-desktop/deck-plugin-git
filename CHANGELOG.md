# Changelog

## 1.11.0 (2026-11-26)

- Pull requests reworked. The list is one list in groups, Waiting for you, Yours, Everyone else,
  and bots' updates folded into one row, with a search field. Each row shows the author's picture
  with a dot for its checks, the title in full, and the one thing that decides it next (Draft,
  changes asked, checks failed or running, approved). A right-click menu opens, checks out, copies
  the link or branch name, or marks it ready or a draft.
- A pull request's header has one filled button for what it waits for: Approve when a review is
  wanted, Merge when nothing is in the way, Mark ready for a draft, Reopen for a closed one, or
  **Can't merge yet** saying what is in the way. Check out sits beside it and the rest is under ⋯.
  Approve and Merge open a small box first; how it merges is one choice.
- Beside the description, what decides the merge: review, checks, conflicts and draft, an answer
  still being worked out shown as such, the checks, the reviewers' last verdicts and the labels.
  People's pictures in the conversation.
- The commits are drawn as the graph draws a branch, and the Files tab's file list is resized
  from its edge.
- The list and a pull request open at once from the last read, then refresh behind it.
- Needs Deck 1.19.0.

## 1.9.0 (2026-11-12)

- In a project with several folders (Deck 1.17.3), the graph offers the repositories of every folder.

## 1.8.0 (2026-11-05)

- An error says how to fix it with a button: a push or pull refused for SSH (`Permission denied
  (publickey)`) offers **Set up an SSH key** (a terminal tab makes a key if there is none, copies it,
  opens the host's page for a new key and tries it) and **Use HTTPS instead** (the remote's address
  over HTTPS, signed in by Git Credential Manager). gh or glab not signed in offers **Sign in**, and
  not installed **Install**. Asks for the terminals permission, to open that tab.
- Double-clicking a branch in the graph checks it out, as in GitKraken: a remote branch with no
  local copy becomes a local branch tracking it.
- Needs Deck 1.15.0.

## 1.7.0 (2026-10-31)

- Each commit shows its author's profile picture from GitHub or GitLab, and their initials when
  there is none; the circles are bigger.
- Resting the pointer on an author shows a card with their picture, name and email. Needs Deck
  1.14.0.

## 1.6.0 (2026-10-30)

- A licence, this changelog, a README rewritten with a screenshot, and the permissions it uses
  declared. Built from its own lockfile.
- Conflicts resolved in a code editor in the Git pane, with a side-by-side view
- Resolve conflicts in the Git pane, not the editor; the banner turns green once none is left
- A Merge Changes section, take either side, and Mark as Resolved that checks the disk
- Merge conflicts in the uncommitted panel, and no commit of leftover markers

## 1.5.1 (2026-10-29)

- A branch chip opens its menu on right-click only

## 1.5.0 (2026-10-29)

- Leaving the Git tab no longer loses an AI message or a failed push
- A notification for each git action

## 1.4.0 (2026-10-28)

- Close a repository tab, and bring it back from a + at the end
- Repository tabs tell two repos of one name apart
- Repository tabs as wide as the workspace tabs
- Repository tabs drawn in the workspace tabs' look, with a yellow changes dot
- Repository tabs look like the workspace tabs, reorder by drag, show changes
- Repositories as tabs, and each Git pane keeps its own place

## 1.3.0 (2026-10-20)

- A right-click menu on changed and committed files, and discard for staged ones
- A branch dragged onto another opens its menu in a floating window

## 1.2.1 (2026-10-19)

- Git's keys follow Settings > Keybindings
- Unstage in a repo with no commit yet

## 1.2.0 (2026-10-18)

- The first version in Deck's plugin registry.
