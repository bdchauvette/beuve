# 0155. Notes, insights and threads in the diff share one head and open in place

- Status: Accepted; amends [0061](0061-review-insights-on-the-diff.md), [0140](0140-other-reviewers-comments-inline-and-optional.md) and [0154](0154-notes-list-rows.md)
- Date: 2026-11-20

## Context

Three kinds of annotation sit under diff lines, and each looked and behaved differently. A staged note was one line with a colored bar (red when it blocked), the note icon, "Staged · label" (with 🛑 and "(blocking)" when it blocked), a ± when it carried a suggestion, its title and an Edit button; its body and suggestion were not shown. A `/review` insight was one line, a bar in its severity's color, that expanded in place on a click, Enter, Space or keyboard focus. Another reviewer's thread was always fully open. In the diff a note needs no location (it is under its lines, in its file's card) and no status (only open notes appear there), and a suggestion is most useful shown in full beside the code it changes.

## Decision

- **One head for all three** (`createAnnotationHead`): the emoji in a column of its own, what the annotation says on one line (ellipsized while closed), its marks, any trailing controls, and a chevron. The emoji and text are a toggle button with `aria-expanded`; a click elsewhere on the head toggles too, while ✨ and the reveal button keep their own clicks. Enter or Space on the toggle opens or closes it, Escape closes it; keyboard focus alone no longer opens anything, so the diff does not shift as the reviewer tabs through it. The card remembers what is open by `data-annotation-key` (`ura:`, `insight:`, `thread:`), across re-renders. A frame tells the kinds apart: solid for a note or a thread, dashed for an insight that is not staged.
- **A note** (`createNoteAnnotation`) uses the notes list's emoji, text fallbacks (title, else the body's first line, else the suggestion's first added line as code) and marks (ADR 0154: here only Blocking, Posted and ✨ can apply). Open, it shows its body as Markdown, its suggestion as a diff and Edit. A double-click still edits it in place (ADR 0129). A note whose lines the diff hides keeps its button that reveals them, in the head.
- **An insight** (`createInsightElement`) shows the emoji of the label it would be staged with (⚠️ for risk and warning, ⛏️ for info), its title, "Insight" (violet) and "Unconfirmed" when the verification pass did not confirm it, then ✨, whose card gives its confidence and Show in chat. Open, it shows its body, Stage, Show in chat, and its category, confidence and check. Unconfirmed insights stay dimmed until opened or hovered.
- **A thread** (`createThreadAnnotation`) is collapsed by default: 💬, the first comment's first line, and its author, its reply count and Resolved as marks. Open, it shows every comment with Open. Threads not on the shown lines stay in the card's list below the diff, as before.
- The old marker's bar, note icon, "Staged", 🛑, "(blocking)" and ± are gone, and so is `createSuggestionBadge`.

## Consequences

Every annotation reads and behaves the same way: one line until the reviewer asks for more. A suggestion shows where it applies, once its note is opened. Other reviewers' threads no longer fill the diff until opened. An open thread repeats its first comment in its head and in its body.
