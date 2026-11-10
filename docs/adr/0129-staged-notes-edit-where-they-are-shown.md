# 0129. Staged notes edit where they are shown, and note fields grow with their text

- Status: Accepted; amends [0027](0027-ura-dock-keyboard-clipboard-and-outdated-items.md), [0074](0074-event-delegation-in-the-renderer.md)
- Date: 2026-11-10

## Context

A staged note could be edited only from the review dock (Space, Review ▸ Note ▸ Edit Note…, the context menu). The reviewer reads notes as markers in the diff (ADR 0027), so correcting one meant finding it again in the dock. Double-clicking a dock row showed the note in the diff, which Return and Show in Diff also do. The note body fields were a fixed three or four lines, as wide as their panel: a long note scrolled inside a small box, and a note in a wide split diff ran to very long lines.

## Decision

- **A double-click on a note edits it**, wherever notes are shown: a dock row opens its editor (a double-click inside the open editor stays there), and a staged note's marker in the diff, in a rendered file's view (ADR 0123) or the plain fallback opens the note composer in the marker's place. Each marker also has an Edit button, which the keyboard reaches. Showing a note in the diff stays on Return and Show in Diff.
- **The diff edits through the composer** (`beuve-ura-composer` with a `draft`): it opens with the note's severity, title and body, previews its suggestion, and says Save. Saving sends the dock's request, `beuve-ura-update` and `ura:update`, with the severity, title and body; the suggestion is left as it is. Only a note the diff marks can be edited there (staged, current on the head, on a file: `noteEditFrom`). The composer closes when the note stops being one. There is no separate edit flow, channel or command: Edit Note… stays the dock's.
- **Delegation** (amends ADR 0074): the diff stream forwards `dblclick` to its cards with `click`, `keydown` and `pointermove`. A marker carries `data-action="note"` (double-click) and its button `data-action="edit-note"` (click); the card emits `beuve-note-edit`, which the stream handles.
- **Note fields grow with their text.** The note body textareas, in the composer and the dock's editor, use `field-sizing: content` between their old minimum and `--beuve-size-note-editor-max` (20em), and are no wider than `--beuve-size-note-measure` (48 × `--beuve-measure-em`, about 80 code columns). Past the maximum they scroll; they can still be resized by hand.

## Consequences

Double-clicking a dock row no longer jumps to the diff. A new place that shows a note should take a double-click to edit it, through the dock's editor or the composer, and not a third editor. A note body never grows past about 13 lines without the reviewer resizing it, and in a wide panel it leaves space to its side.
