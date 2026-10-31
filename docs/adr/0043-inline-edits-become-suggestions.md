# 0043. Inline edits become suggested patches, never writes

- Status: Accepted
- Date: 2026-10-29

## Context

Spec 5A reserves `e` for inline edit, and ADR 0018 noted that `@pierre/diffs/edit` is a real editor that attaches only to a diff with both full files and leaves writing to us. A reviewer who edits code in a review means "change it like this", which the URA already models as a suggested patch (ADR 0023) that exporters turn into GitHub ` ```suggestion ` blocks or hand to agents. Writing the head checkout or the reviewer's working tree would make beuve an authoring tool, break the head the review is anchored to and race with the author.

## Decision

- **`e` edits, nothing is written.** On the focused hunk, or the head-side line selection, `e` loads both sides with `session:get-file-pair`, hydrates the card's `FileDiff` (`prepareForEditing`), and attaches an `Editor('file-diff')` from the lazily loaded `@pierre/diffs/edit` chunk, caret on the first target line. A bar in the sticky header names the lines and the keys: ⌘/Ctrl+Enter saves, Escape cancels; while editing, keys never reach the stream's shortcuts. Saving or cancelling discards the editor's document and remounts the diff as it was. No path writes a file.
- **What is edited** (`planEditTarget`): when the cursor line (as `o` picks it) lies on a staged line note written against the head being shown, that note's lines, and the suggestion attaches to it; otherwise the lines `m` would stage. Notes from older heads are skipped, because their line numbers refer to another file; a deleted or binary file has nothing to edit.
- **Edit → patch** (`buildSuggestedPatch`, pure): everything outside the target lines must be unchanged, else saving is refused in the bar ("Edits must stay within lines 7–8") and editing continues. The patch is one hunk that removes every target line and adds what replaced them, with up to three context lines and `--- a/<path>` / `+++ b/<path>` headers, keeping `\r` and git's no-newline marker. Removing every anchored line is what lets `buildGithubReview` post it as a ` ```suggestion ` for exactly those lines; any other patch (from MCP, say) still becomes a ` ```diff ` block. Main validates it again with `parseSuggestedPatch` against the item's anchor on `ura:create`/`ura:update`. An edit that changes nothing just closes.
- **Where it goes.** Attached: `ura:update { suggestedPatch }` on the note. Otherwise the `m` composer opens on those lines with the patch previewed and staged with the note (`ura:create { suggestedPatch }`); severity stays `issue` by default, and the reviewer can pick `nit`.
- **Seeing and changing it.** Dock items with a patch say `suggestion` and preview it (`beuve-patch-preview`) under the cursor; card markers read `Staged · Issue · suggestion`. The item editor offers "Edit suggestion…" (or "Suggest a change…") for staged line notes current on their head, which opens `e` on the note's lines starting from the suggested text (`applySuggestedPatch`; undo returns to the head), and "Remove suggestion" (`suggestedPatch: ''`).
- **Out of scope**: applying a suggestion to a working tree. A later, explicit action could offer it for local sessions whose tree is clean at the session head; it would need its own ADR.

## Consequences

Reviewers can say "like this" with real code, and every export already carries it: GitHub suggestions for replacements of the anchored lines, a diff block otherwise, the patch in the agent JSON and XML. Edits outside the chosen lines are refused rather than silently widening the note; to suggest a larger change the reviewer selects more lines first. The editor works on the plain head file, so under the whitespace-ignoring display (ADR 0042) the edit session shows the full diff. One edit per card at a time; a card being edited stays mounted however far the stream scrolls.

## Amendment (2026-10-31, ADR 0088)

Edits made outside beuve can become suggested patches too. Open Review Edits gives each session one writable local branch, checked out in a worktree of its own; Turn into Suggestions snapshots it (uncommitted and untracked files included, on a temporary index) and turns each change region inside lines the pull request changed into a patch of this ADR's shape, validated with `parseSuggestedPatch` and attached to a covering staged note at that head when there is one; other edits become notes with a ` ```diff ` block. Nothing is staged without a preview. The rule "no path writes a file" is narrowed to: beuve writes only the review-edits worktree, through `git worktree`, never the reviewer's checkout or its own read-only ones, and never pushes.
