# 0156. Copying the review saves progress, and any save can be removed

- Status: Accepted; amends [0142](0142-undo-save-progress-and-review-range.md) and [0146](0146-opening-progress-and-reload-review.md)
- Date: 2026-11-24

## Context

The interdiff (ADR 0012, 0142) is only as good as the checkpoints behind it, and a checkpoint is recorded only when the reviewer remembers Save Progress. In practice the moment a round of review ends is the moment the reviewer copies it for an agent or a colleague, and that is exactly when Save Progress gets forgotten: the next round then shows the whole change again instead of what the author did about the notes.

Saving more often raises the stakes of a wrong save, and Undo Save Progress (ADR 0142) only removed the save this window had just made, while it was still the latest. A save from yesterday, or one made right before a restart, could not be taken back.

## Decision

- **Every Copy Review export saves progress.** After Copy Review as XML, Copy Review as JSON or Copy GitHub Review (JSON) has put the review on the clipboard, beuve runs Save Progress at the head. The review stays as shown (`markReviewed({ keepShown: true })`): the reviewer just exported what they are looking at, and a save that emptied the diff would hide it. The next load shows what changed since. The status bar says "Progress saved with the export" with Undo, as after Save Progress. A failed copy saves nothing, and a head that was already saved records no new checkpoint and shows no notice. Post Review to GitHub is unchanged.
- **Undo Save Progress removes the latest save, whoever made it,** and is titled Remove Last Saved Progress in the Review menu. It deletes the open session's latest checkpoint: this window's last save on it if there is one, else the one the review was loaded with (`SessionSummary.lastCheckpointId`). Run again, it removes the one before, down to none. `session:undo-mark-reviewed` already refuses a checkpoint that is not the latest, so history under a later checkpoint is still never rewritten; removing the saves one by one from the newest is how an older one goes.
- **Remove Last Saved Progress is also where the reviewer looks for it:** the last item of the review range menu (`beuve-review-range`, below a separator), and a quiet button on the up-to-date screen beside Show the Whole Change. Both emit `beuve-remove-saved-progress`, which the review answers with the command.
- **The up-to-date screen** uses the empty-screen layout (`emptyStateStyles`, ADR 0115) the home screen uses: a title, "Nothing new to review", a line saying new commits show there, and the two buttons, in place of one muted line and a button in the top corner of an empty pane.
- **A pull request picked in the Open dialog opens under the cover** (amends ADR 0146): the dialog closes and `beuve-opening` shows over the review with the ref as its label, as a queue pick does; a failure brings the dialog back on its pull request step with the failure. The home screen's panel is not a dialog: it stays under the cover and shows a failure in place.

## Consequences

- An export is a checkpoint, so the interdiff works without the reviewer remembering to save, at the cost of a save after an export the reviewer only wanted to look at. Undo is one click, and Remove Last Saved Progress walks back any number of saves.
- Removing saves only from the newest keeps the data model of ADR 0142 (a review range choice naming a checkpoint cascades with it), at the cost of having to remove the newer saves to reach an old one.
- A dialog pull request open no longer shows the dialog's own "Fetching…"; the cover does, and Escape or Cancel on it stops the fetch.
- On Linux, Remove Last Saved Progress takes the Review menu's R, so Review Range moves to E and Review Edits to V.
