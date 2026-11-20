# 0153. The review notes are a "notes list", not a "dock"

- Status: Accepted
- Date: 2026-11-20

## Context

The list of review notes in the sidebar's Review tab (Zone 3) was called the "dock", "staging dock", "review dock" or "URA dock" in tooltips, an error message, code (`beuve-ura-dock`, `dockItemOf`, the `dock-*` command ids, the `dock-item` menu condition) and about fifty ADRs. Nothing on screen is called a dock, it is not docked to anything the reviewer can move, and on macOS "the Dock" is the system's app launcher, which beuve's code also mentions.

## Decision

- **It is the notes list**: "the notes list" in prose, tooltips and messages ("Stage this finding on its lines in the notes list"), "note order" for the order notes export in.
- **Code follows**: the element is `beuve-note-list` (`BeuveNoteList`), helpers are `noteList…` (`noteListItemOf`, `noteListCheckedCommands`, `noteListSelectionAfter`, `resolveNoteListVerdict`), command ids are `note-*` (`note-show`, `note-withdraw`, `note-label-issue`, …) and the menu condition is `note-item`. ADR 0027's file is renamed to match.
- Existing ADRs are reworded in place rather than amended, since the change is a name, not a decision; mentions of the macOS Dock are untouched.
- Nothing persisted or sent over IPC used the word, so no migration or channel change is needed.

## Consequences

The word "dock" means only the macOS Dock in beuve. New code and docs say "notes list". The Review tab and its notes list remain two things: the tab also holds review edits and the export controls.
