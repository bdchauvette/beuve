# 0063. One review target for every line-taking action

- Status: Accepted; amends [0061](0061-review-insights-on-the-diff.md) (the insight merge key)
- Date: 2026-10-30

## Context

Seven actions ask "which lines?": `m` (stage, ADR 0027), ⌘> and the gutter button (add to chat, ADR 0046), `e` (suggest, ADR 0043), `o` (open in editor, ADR 0033), `p` and `Shift+p` (peek and flow) and `r` (trace). Each answered it on its own (`planStageAnchor`, `planChatMention`, `planEditTarget`, `planEditorLine`, and the stream's `targetLine`), with drifting rules: `m` dropped a base-side selection and fell back to the hunk, ⌘> kept it, `o` mapped it to its hunk's first change, and `p`/`Shift+p`/`r` ignored selections altogether. A citation or flow-node jump moved the view but not the cursor, so the next action still took the old hunk or the file.

## Decision

- **One pure resolver.** `targetFrom(state)` reads the active card's cursor state (file, focused hunk, the reviewer's own selection, the line the last jump landed on, collapsed) and returns a `ReviewTarget`:
  - `selection`: `side` `base` when both ends lie on deleted rows or the split view's left column, else `head`; a selection across both sides is mapped to head lines. It always carries its head-side range (`head`), mapped from the base side by `headNumberFromBase` (exact for unchanged lines inside and between hunks, the head line before the gap for a deleted line); `undefined` only on a deleted file.
  - `hunk`: its head lines (none for a pure deletion), base lines (none for a pure addition) and first changed head line.
  - `line`: the head line a citation, find hit, flow node or trace line jumped to.
  - `file`, with its first changed head line; `change` when no file is active.
- **Precedence**: no active file → `change`; a collapsed card (ADR 0052) → `file`, since a stale selection or hunk is not on screen; a selection → `selection`; a jump's line → `line`; a focused hunk → `hunk`; else `file`. `j`/`k` clears the selection and the jump's line; a selection clears the jump's line. The selection `j`/`k` draws is never the reviewer's.
- **Each action adapts the target**, purely: `anchorFromTarget` (`m`; URA anchors are head-only, so a base selection stages its head lines and a pure deletion the head line before it; a deleted file anchors to the file), `mentionFromTarget` (⌘>; keeps the base side and path), `lineFromTarget` (`o`, and the line `p`, `Shift+p` and `r` find the enclosing function of; a selection's first head line), and `editTargetFrom` (`e`; the `m` lines, or the staged note under the `o` line). The per-action planners are deleted. The dock's ⌘> reads a staged note's anchor as a target too (`targetFromAnchor`: lines as a head selection, a file as the file) and goes through `mentionFromTarget`, so a note on a deleted file adds its base side like the diff does.
- **Insight merge key** (amends ADR 0061): a finding made again is the same file, overlapping head lines and the same title once normalized (case, inline-code and emphasis marks, spacing, a closing full stop); the newest wins. Category is no longer part of it, so two different problems of one category on the same lines stay separate, and a rerun that recategorizes a finding still merges it.

## Consequences

Every action agrees on the lines, and adding an action means writing one adapter. `p`, `Shift+p` and `r` now honour a selection, and `m` and `e` on a base-side selection take the head lines it maps to instead of the whole hunk. After a citation jump the cited line is the target until `j`/`k` moves on. A rerun that rewords a title beyond the normalization shows the finding twice until the older answer leaves the head.
