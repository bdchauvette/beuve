# 0154. A notes-list row: what the note says, where it is, and only what is marked

- Status: Accepted; amends [0027](0027-ura-note-list-keyboard-clipboard-and-outdated-items.md), [0131](0131-conventional-comments-labels-and-a-blocking-decoration.md) and [0144](0144-note-names-by-state-menu-icons-and-bulk-notes.md)
- Date: 2026-11-20

## Context

A row of the notes list put a metadata line first and the note second: the note icon, the label in a colored, bordered chip, the path, "outdated", "posted", the suggestion glyph and the origin ("human", "review finding · 82%") or the closed status, then the title. Several facts were said three times: the label (emoji, word, chip color), blocking (🛑, "(blocking)", red) and a closed note (its status word, 60% opacity, strikethrough). Every row repeated the note icon in a list that holds only notes, and "human" on every note the reviewer wrote. A note with only a suggestion had an empty headline.

Reviewers scan the list to find a note to act on, to check what is still open and what blocks before posting, to triage an agent's notes, and to catch notes that are outdated or already posted. A review has a few dozen notes at most, mostly closed ones, and under fifteen open ones, so rows can afford a few lines; what they cannot afford is noise.

## Decision

- **The label's emoji gets a column of its own**, named by the label's word for screen readers and in its tooltip. Colors per label and the bordered chip are gone.
- **The first line is always what the note says**: its title in medium weight; else its body in regular weight, up to two lines; else its suggestion's changed lines. The cursor row adds the suggestion's preview when the note also has words.
- **The second line is always the path**, on a line of its own, in the code font, cut from the left when too long so the file name and lines stay; the full path is its tooltip. A note on the whole change says "Whole change".
- **A third line names only what is marked**, borrowing markedness from linguistics: the default (written by the reviewer, open, current, not posted, not blocking) is never shown. In order: Blocking (red), Outdated (amber), Posted, Addressed (green) or Withdrawn, as words separated by "•", each with a tooltip that says more (`noteMarksFrom`), then ✨ when an agent wrote the note, last because it matters least. Blocking stays on closed notes, so a note that blocked says so. Whether a note carries a suggestion is not marked: the cursor row shows it.
- **✨ is `beuve-agent-mark`**, a primitive (ADR 0115) with a story: a button named "Written by an agent" whose card says where the note came from ("From a /review finding, 82% confidence", "Proposed in a chat answer", "Staged from a chat answer"; `describeAgentOrigin`) with **Show in chat**. The card shows when the pointer rests on ✨ or ✨ takes keyboard focus, stays while the pointer is over it, hides on Escape or when both leave, and a click pins it without reaching the row. Only the cursor row's ✨ is in the Tab order. Show in chat sends a composed `beuve-show-in-chat`; the review opens the chat and `revealSource` scrolls to the finding, the proposal or the answer and marks it for a moment. ✨ already means the model in beuve (the composer's drafting button), which is why praise moved to 🎉 (ADR 0131 amendment).
- **Closed notes sit under a "Closed" heading** with their count, in a list of their own, in muted text without strikethrough or opacity. Show Closed Notes (ADR 0149) hides the heading with them.
- The note icon, the origin text, "human" and the suggestion glyph leave the row. The diff's note markers keep theirs until they get the same treatment.

## Consequences

Every row starts with what the note says, and the path never competes with anything for room. Rows with marks are a line taller, so the taller rows are the ones that need attention. An agent's note is one glyph wider, and its details are a hover or a focus away. A label's word is no longer on screen; its emoji carries it, with the word in the tooltip and for screen readers.
