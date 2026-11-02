# 0101. The diff gutter button opens a review note

- Status: Accepted
- Date: 2026-11-02

## Context

ADR 0046 made the `@pierre/diffs` gutter button add the hovered line or selection to the chat, as a speech bubble. Staging a note is the more frequent review action, and it had no pointer affordance, only the `stage` chord. The library offers one gutter button, so both actions cannot have one.

## Decision

- The gutter button opens the note composer on the clicked line or the selection (a drag from it selects lines first). It shows the note icon (ADR 0100).
- The click also selects those lines, so Add to Chat (`add-to-chat`, ⌘> / Ctrl+>) takes the same lines to the chat from the keyboard. The chat bubble is no longer on the button.
- The card emits `beuve-note-add` with the anchor from `anchorFromTarget` (ADR 0063); the stream makes that card active and opens its composer.

## Consequences

- Adding lines to the chat by pointer alone is gone; it needs the chord or the command palette.
- Amends ADR 0046's description of the gutter button.
