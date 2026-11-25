# 0146. A review shows that it is opening from the moment it is picked, and Reload Review fetches it again

- Status: Accepted
- Date: 2026-11-18

## Context

Picking a pull request in the Review Queue (ADR 0113) closed the queue and then showed nothing while main asked GitHub for the pull request and fetched its head and base. The diff stream's "Opening review…" bar appeared only once the session itself started loading. Over an open review, that review stayed on screen. On the home screen the queue stayed, and a second Enter was ignored with no sign why. The fetch was cancellable (`requestId`, `request:cancel`, ADR 0079), but only the Open panel offered a way to cancel it.

Nothing reloaded a review on request either. Show New Commits reloads only after polling (ADR 0038) has seen a new head, and the queue's Refresh button reloads only the queue.

## Decision

- **One opening view.** `beuve-opening` (`src/ui/beuve-opening.ts`) shows what is opening, an indeterminate bar, and the step it is on. The bar is a primitive style module, `progressStyles` (`.progress`, ADR 0115), with a story. The diff stream's "Opening review…" uses the element, so the two steps look the same.
- **The fetch is shown from the pick.** `GithubController.open(request, { label })` records the fetch in flight (`GithubFetch`: `open` or `reload`, its step, and a label) and keeps it until the session starts loading, so the window never flashes back to what it showed before. An open with a label (from the queue, or a pull request from the palette) shows `beuve-opening` over the review area: "Fetching pull request #12…" or "Fetching branch x…", with the item's name, as the titlebar will name it. What was shown stays under the cover, so a failed or cancelled open leaves it as it was. The cover takes the focus, so Enter does nothing more, and Escape or Cancel stops the fetch. Stop (ADR 0068) stops it too, because a fetch counts as `busy`. When the fetch ends, the session's own "Opening review…" follows with the same name. A failure still opens the Open dialog's pull request step (ADR 0113), and a cancel gives the keyboard back to the queue or the review.
- **The Open panel keeps its own progress.** It already shows "Fetching…" with Cancel and its failures in place, in the dialog or on the home screen. Covering it would lose the step the reviewer was on, so an open from the panel has no label.
- **Reload Review** (`reload-review`, Review menu, Cmd+R / Ctrl+R) fetches the open session again the way it opened. For a pull request or a followed branch, `github:open-pr` or `github:open-branch` runs with its ref and clone, which fetches the head and base and moves the session's head (`upsertFetchedSession`). The review then reloads in place (`SessionController.select` with the same id), keeping the cursor and scroll as Show New Commits does. A local session reads its repository again. A failed fetch is an error notice and leaves the review open, with no Open dialog. A review that failed to load loads again. Over the Review Queue, or on the home screen, which shows the queue, it refreshes the queue. The titlebar shows Reload next to the review's name while a review is open. The button runs the same command, shows "Reloading…" while the fetch or the reload runs, and takes its key from the catalog for its tooltip. Cmd+R is free: beuve builds its own menu, which has no `reload` role, and the old trace command that used it is gone (ADR 0096). On Linux, Ctrl+R gives way to a focused terminal, as every keyed command does (ADR 0095).
- One fetch at a time: an open or a reload asked for while another runs does nothing.

## Consequences

The window answers a pick at once, and a slow fetch can be stopped. The look of indeterminate progress has one home. Reload Review is the reviewer's way to see a new head without waiting for the poller. Because it moves the head, a pending GitHub post confirmation gives way to the head-moved note, as after Show New Commits (ADR 0078). Reloading with nothing new still reloads the review, which is cheap. A future step shown during opening (cloning, say) adds a stage string, not a new view.

## Amendment 2026-11-18: Reload is an icon

The titlebar's Reload is an icon-only `.button.icon` with the refresh glyph, named "Reload Review" for assistive technology, with the catalog's title and key as its tooltip. While the fetch or the reload runs it is disabled and `aria-busy`, and the glyph spins as the Review Queue's Refresh does; under reduced motion the glyph holds still and the disabled look says it is busy. There is one refresh glyph: it moves from the queue's icons (`queueIcon`) to `displayIcon`, the glyphs of icon-only controls, which both use.

## Amendment 2026-11-25: one cover over the whole review

The cover (`reviewCoverFrom`) is up from the pick until the new review arrives: during the fetch, then while the picked session's review is read (a session picked from the palette or the Open dialog goes straight to this second step). It is one `beuve-opening` whose step changes from "Fetching pull request #12…" to "Opening review…", so it appears once; the diff stream no longer draws its own. While it is up, everything that described the review being replaced is hidden from the first frame: the sidebar and the terminal (hidden and inert, still mounted, so a cancelled open restores them as they were), the titlebar's diffstat and view controls, and the status bar's range, span, scope, branches, attention, remote branch and save state. The window no longer shows the old review around the cover, and then an emptied window, before the new review appears.
