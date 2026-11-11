# 0135. Pull request descriptions in a sheet

- Status: Accepted
- Date: 2026-11-11

## Context

A pull request's description is shown only in the Overview tab (ADR 0109), in a box capped at `--beuve-size-scroll` inside a narrow sidebar. A long description (a design write-up, a checklist, a table) is hard to read there, and it disappears when the reviewer switches to Files. Reviewers wanted to keep it open beside the diff the way they keep files open in sheets (ADR 0067). Sheets are snapshots of a file at a commit; a description belongs to no commit and is not in the repository.

## Decision

- **A description sheet is a second kind of sheet window.** It shows the title, state badge, author, branches and Markdown body (rendered as in the Overview, ADR 0073, with the plain renderers) of the session's pull request as main last read it, in the prose font (ADR 0124) at a readable measure. Like a file sheet it is a printout: read-only, stamped with when it was printed, never refreshed or reused, Esc or Close Window closes it. When the window gains focus and the title or body on GitHub (as main last polled it) differs from the printed one, the footer says so quietly.
- **Opening it.** Review › Open Description in Sheet (`open-description-in-sheet`, no keys, enabled for pull request sessions), and an Open in Sheet button in the Overview's description, which emits `beuve-description-sheet-request` for `beuve-review` to answer. Both call `sheet:open-description { sessionId }`, a main-window channel: main reads the pull request through `github.getPullRequest`, refuses when there is none, and opens the window through `SheetWindows.openDescription`, which shares the file sheets' window options, bounds and Close All Sheets. The query string carries only `kind=description` and the session; the body never travels in it.
- **One more sheet channel.** The page reads the description with `sheet:get-description { sessionId }`, added to `sheetInvokeChannels`. It answers only what `github:get-pr` already answers to the main window (the stored pull request), so it widens no write or network surface. `sheet:open-description` is not a sheet channel.
- **Links are copied**, as in a rendered file's sheet (ADR 0123): a sheet opens nothing. Copy link in the header copies the pull request's URL. The menus act on nothing in a description sheet (it sends no menu conditions), so Find, Back, Forward and the permalink commands are disabled there.

## Consequences

A long description can sit beside the review at any size, and several can be laid out for a stack. The sheet shows what main last polled, so an edit made on GitHub seconds ago may not be in it until the next poll; the change note has the same lag. There is no find in a description sheet yet, and images outside the app stay blocked by the CSP, as in the Overview. The sheet page now has two entry kinds, chosen by its query string.
