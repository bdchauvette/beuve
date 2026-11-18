# 0140. Save Progress can be undone, and the review range is a stored per-session choice

- Status: Accepted
- Date: 2026-11-18

## Context

Save Progress (`save-progress`, ADR 0012) records a checkpoint, and the next review shows only what changed since it. A reviewer who saves by accident, or wants to look at the whole pull request again, had no way back: with no new commits the review read "Up to date" and showed nothing, and after new commits it showed only the interdiff. Every review read (the diff, its order, file attributes, URA re-anchoring, chat, LSP) goes through `loadReviewDiff`, so whatever picks the range must be seen by all of them, not only by `session:get-review`.

## Decision

**Undo.** `session:undo-mark-reviewed { sessionId, checkpointId }` deletes that checkpoint (`deleteLatestCheckpoint`, session domain) only while it is still the session's latest; a later save makes it `refused` (`checkpoint-superseded`), a deleted or foreign one `not-found`. Only the most recent save can be undone, so undo never rewrites history under a later checkpoint. Deleting the row is safe: nothing references `checkpoints` but `review_ranges`, which cascades; file marks, notes and chat never depended on a checkpoint, and posting a GitHub review records none, so posting does not block undo. `SessionSummary` gains `lastCheckpointId`; the renderer compares it before and after `session:mark-reviewed` to know whether this save recorded a checkpoint. After a save that did, the status bar says so with an Undo action (`undo-save-progress`, like `undo-delete-note`), and Review › Undo Save Progress runs the same command after the notice is gone. Undo applies to the save made in this window on the open session, once; with nothing to undo it says so.

**Range.** A session stores which range its review shows, in `review_ranges` (migration `session-0002-review-ranges`, in `src/internal/session/session-review-ranges-migration.ts`: `session_id` primary key cascading from `sessions`, `kind` `whole` or `since-checkpoint`, `checkpoint_id` cascading from `checkpoints`). No row is the default, `since-last`: what changed since the last checkpoint, as before. `whole` is the whole change from its fork point regardless of checkpoints (the stack-aware fork point with the latest reviewed base, as Save Progress records it); `since-checkpoint` is the interdiff from an earlier checkpoint the reviewer picked, which the data supports for free since checkpoints already hold `{ baseSha, headSha }`. `computeReviewRange(session, choice)` turns it into a `ReviewRange`; `loadReviewDiff` reads the choice, so every service shows the same diff. `session:set-review-range` stores it; `ReviewView.range` carries the choice and the session's checkpoints.

The choice **persists per session** in the database, not in the renderer: it is what every main-side read must agree on, and it survives a reload or restart the way the review state does. Saving progress (a new checkpoint, or re-saving the same one) puts it back to `since-last`, since signing off means "show me what changes after this". Undoing a save does not restore an earlier choice; the review falls back to `since-last`, which is what it showed before the save in the common case.

**Controls.** The review header shows a `beuve-review-range` menu (a `beuve-menu`, ADR 0115) next to the scope once the session has a checkpoint: Since last saved progress, Whole change, and earlier saves newest first with their commit and time. The up-to-date state offers Show the Whole Change. Review › Review Range has radio items for the two fixed choices (`range-since-saved`, `range-whole`); earlier checkpoints are only in the header menu, since the catalog is static.

**Migration order.** `session-0002-review-ranges` lives in a file of its own and is appended to the end of `appMigrations`, after every domain's shipped list, in the order it was written (ADR 0006 amendment 2026-11-18), so the list is the order an upgraded database applies them in (the fixture tests compare applied ids with the list).

## Consequences

- An accidental save costs one click, and the whole change is always one menu choice away, with or without new commits.
- Review › Review Range and Undo Save Progress take mnemonic letters on Linux; Edit Setup Command… lost its mnemonic.
- A domain migration added after the first release goes in a file of its own, appended to the end of `appMigrations`, not to its domain's list (ADR 0006 amendment 2026-11-18).
- Undo is limited to the latest save from this window; older saves stay, but `since-checkpoint` and `whole` show what they covered.
