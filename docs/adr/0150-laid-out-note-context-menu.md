# 0150. The note's context menu is laid out by hand, with Label and Status submenus

- Status: Accepted; amends [0068](0068-native-menus-chorded-keymap-and-a-settings-window.md) and [0144](0144-note-names-by-state-menu-icons-and-bulk-notes.md)
- Date: 2026-11-20

## Context

Context menus were derived from the catalog: the commands that list a kind, grouped by their menu-bar menu and group (ADR 0068). A note's menu came out as Open in Editor, then nine items in one group (Show in Diff, Edit, Withdraw, Delete, Blocking, Change Label…, Addressed, Move Up, Move Down), then Add to Chat. Delete sat between Withdraw and Blocking; the two status commands were three items apart; the main action, Show in Diff, came second; every label repeated "Note"; and the separator before Move Up and Move Down was lost, because derived context menus ignore the menu bar's subgroups. Relabeling took a dialog (Change Label…), and moving a note from addressed to withdrawn took two commands.

## Decision

- **A kind may have a hand-made layout** (`contextMenuLayouts` in `src/contract/context-menu-layouts.ts`): sections of commands and submenus, top to bottom. `contextMenuTemplateFrom` follows it for that kind and derives the others as before. Every command whose `context` names a laid-out kind appears in its layout and nothing else does; a test holds both ways. A layout entry may override the label and show the command as a checkbox, for that menu only. Laid-out items use the catalog's short `label` and show no icons.
- **The note's menu**, grouped by intent:
  1. Show in Diff · Open in Editor
  2. Edit… · Label ▸ (the ten labels, then Blocking)
  3. Status ▸ (Open, then Addressed · Withdrawn)
  4. Move Up · Move Down
  5. Add to Chat
  6. Delete
- **Label and Status are catalog commands** (`notes list-label-<label>`, `note-status-open|addressed|withdrawn`), since the labels are a fixed list (ADR 0131). Each checks when every note it acts on has that label or status (`noteListItemOf` reports the shared `status` and `severity`; `noteListCheckedCommands` names them), so a mixed selection checks none. They are checkboxes, not radio items, because Electron may check the first radio item of a group in which none is checked. Mark Note as Blocking shows as a "Blocking" checkbox in the Label submenu. Choosing one sets every targeted note that does not already have it, in one `ura:edit-many`.
- **Status goes straight between the closed statuses**, through the status actions of ADR 0151: Open reopens, Addressed marks addressed, Withdrawn withdraws, from whichever status the note has.
- **The palette leaves the Status commands out** (`inPalette: false` in the registry): Withdraw, Restore and Mark as (Not) Addressed already do the same there, and the palette's greedy matcher ranked "Set Note Status to Addressed" above "Mark Note as Not Addressed" for "not addressed". The Label commands are in the palette ("Set Note Label to Nitpick").
- The menu bar's Note menu (ADR 0152) mirrors this layout. Withdraw, Mark as Addressed and Change Label… stay catalog commands for the notes list's in-place keys and the palette, but neither menu shows them.

## Consequences

The note's menu reads from looking, to changing, to concluding, to ordering, with Delete alone at the end, and labels and status change in one gesture. A new note command must be placed in the layout by hand, which the test enforces. The menu bar's Note menu and the context menu share one structure.
