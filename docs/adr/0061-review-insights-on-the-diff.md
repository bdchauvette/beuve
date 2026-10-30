# 0061. `/review` findings also show as quiet insights on the diff lines

- Status: Accepted; amends [0055](0055-review-folded-into-chat-with-verification.md) (findings "no longer appear on the diff lines")
- Date: 2026-10-30

## Context

ADR 0055 folded the preliminary review into the chat and took the findings off the diff. Reading them in the transcript and jumping with a citation pill works, but the reviewer then reads the code without them. They want `/review` to behave like an extra, AI-powered ESLint: the notes sit on the lines, quiet, and there is still no dedicated navigation, no keys and no state of its own.

## Decision

- **Source of truth stays the chat.** The insights of a session are derived in the renderer from the stored `/review` answers that `chat:list` and `chat:message-updated` already carry (`ChatMessageView.review.findings`, with `headSha`). There is no new table, service, channel or contract field; a main integration test pins that the findings, their lines, their check and the head arrive on those channels.
- **Which findings** (`mergeReviewInsights`, pure): completed `/review` answers whose `headSha` is the session head, every scope together. A finding made again (same file, overlapping lines, same category) shows once, from the newest answer; findings of one answer are never merged with each other. `withoutStagedInsights` drops a finding when any answer that made it was staged, so a rerun never offers it again and the dock's own staged marker is the only one shown.
- **Rendering.** In a diff card, split (head side) or inline: a small dot in the number cell of the first shown cited line, coloured by severity (risk red, warning amber, info muted; the most severe wins on a shared line), drawn by one adopted style sheet in the library's shadow root, and under the last cited shown line a one-line note: category, the title with inline code, truncated. Click, Enter or Space, or keyboard focus, expands it in place to the body (the safe Markdown subset as text nodes, never `innerHTML`) with **Stage** (`ura:stage-review-finding`, exactly the chat answer's Stage) and **Show in chat** (opens the chat tab, scrolls to and briefly marks that finding; the diff keeps the focus). Escape collapses. An unconfirmed finding is dimmed and says so; unchecked ones (`--no-verify`) are plain. A finding on a collapsed card (ADR 0052) shows as an "n insights" tag in its header; ranges no hunk shows sit above the first hunk like other file-level notes.
- **No new keys.** `j`/`k`, ⌘F (which searches the diff's data) and citation pills land on the lines the notes sit under. Notes are focusable in tab order only.
- **Toggle.** `/insights show|hide` (bare `/insights` says which) and the palette's "Show / hide review insights on the diff", in the command registry (palette, shortcut overlay, `/help`). Main keeps `showInsights` in `settings.json` with the other display preferences (`display:get`/`display:set`, ADR 0042), default on.
- **Stable props.** The shell recomputes the merged list only when the head, the review answers or the staged set change, and the stream slices it per file with `groupStable` (ADR 0050), so streaming chat text never re-renders the cards.
- **Also.** URA dock titles render inline code, bold and italics through the same inline parser (they showed raw backticks).

## Consequences

Findings are visible where the code is read, at no cost to the diff's navigation or its render budget. They exist only after a `/review`, per head: a new head shows none until `/review` runs again. Merging by file, lines and category is a heuristic; two different problems in the same lines and category read as one. The dot relies on the library's gutter markup (`[data-column-number]`), like the row selectors already do.
