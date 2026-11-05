# Changelog

## Unreleased

- An error says how to fix it with a button: a push or pull refused for SSH (`Permission denied
  (publickey)`) offers **Set up an SSH key** (a terminal tab makes a key if there is none, copies it,
  opens the host's page for a new key and tries it) and **Use HTTPS instead** (the remote's address
  over HTTPS, signed in by Git Credential Manager). gh or glab not signed in offers **Sign in**, and
  not installed **Install**. Asks for the terminals permission, to open that tab.
- Double-clicking a branch in the graph checks it out, as in GitKraken: a remote branch with no
  local copy becomes a local branch tracking it.

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
