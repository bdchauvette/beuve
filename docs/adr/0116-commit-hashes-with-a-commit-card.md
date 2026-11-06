# 0116. Commit hashes show a card with the commit, asked for by a request event

- Status: Accepted; extends [0108](0108-commit-hashes-open-on-the-remote.md) and [0115](0115-ui-primitives.md)
- Date: 2026-11-06

## Context

The review shows commit hashes in the diff stream's header, in the "Progress saved" stamp and in a pull request's timeline. Each was seven or eight characters and a link to the remote; the subject, author and full hash took a trip to GitHub. A card on the hash needs the commit's object, which only main reads. ADR 0104 keeps presentational components away from the bridge, and the hashes sit two or three components deep under the review, so passing a reader down every component that might show one would spread plumbing through components that do not care.

## Decision

- **`readCommitInfo`** (`src/internal/git`) reads a commit object on the repository's warm `cat-file --batch-command` (ADR 0087) and parses its headers: parents, author and committer (name, email, time as a `Temporal.Instant`), subject and body.
- **`session:get-commit { sessionId, sha }`** answers a `CommitInfoView` (times as ISO instants). It takes a full commit name of the session's repository, resolved as `remote:open-commit` and sheets resolve it (`resolveSheetCommit`); a commit the clone lacks is `not-found`. It is not a superseded request kind: two hashes may each want their card.
- **`beuve-commit`** (`src/ui/primitives/`) shows `abbreviation` characters (7 unless set) in monospace with a dotted underline, and a card under it: the subject, the body (scrolls past `--beuve-size-scroll-short`), the author with a relative `beuve-time`, the committer when someone else committed it or more than a minute later (`commitCardFrom`, tested), the parents ("Parent 1a2b3c4", "Merge of … and …", "Root commit"), an optional `hint` for what a click does, and the full hash with Copy. The card shows after the pointer rests 400 ms or at once when the hash takes keyboard focus, stays while the pointer or focus is on it, and closes on leaving or Escape (focus back on the hash). A click on the hash is the owner's (`data-action` on the element); a click in the card never reaches the owner.
- **Data by request event.** The element dispatches a composed `beuve-commit-info { sha, respond }`; whoever can read commits calls `respond(promise)`. `beuve-review` answers from `session:get-commit`, cached per session and hash. With no answer the card shows the full hash alone ("Not in this clone" when the read fails). Copy dispatches `beuve-copy-text { text }`, which the review sends to `clipboard:write-text` with its usual notice. This is the shape for any primitive that needs data from main: the element asks up the tree, a container answers, the element never calls the bridge.
- **Where:** the diff stream's header range and "Progress saved", and the pull request timeline's commits. The commit pairing rows keep plain text: each row is itself the click target that filters the stream.

## Consequences

A reviewer reads a commit's message and authorship without leaving the review, and copies a full hash in two clicks. The request event is untyped at the DOM level (listeners cast it), so the detail types live beside the element and the review imports them. A hash outside the review (the open panel, a sheet window) would need its own container to answer, or it shows only the full hash. Signatures (`gpgsig`) are not checked or shown.
