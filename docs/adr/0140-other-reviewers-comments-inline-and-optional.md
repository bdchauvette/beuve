# 0140. Other reviewers' line comments, inline and optional, behind a host-neutral port

- Status: Accepted
- Date: 2026-11-18

## Context

beuve shows a pull request's commits, reviews and conversation comments in the Overview (ADR 0110), but not the comments other reviewers left on lines of the diff: ADR 0110 left them out because they belong to review threads. A reviewer joining a pull request halfway can't see what has already been said about the code in front of them without opening GitHub. Two things shape the answer. The reviewer asked for it to be optional, since a reviewer who wants to form their own view first should be able to keep the diff clean. And GitHub is only the first host: GitLab and others have the same idea (a discussion on lines of a merge request), so the model and the way it reaches the renderer must not be GitHub's.

## Decision

- **A host-neutral model.** `ReviewThreadView` (in the IPC contract): an id, a head-side or base-side `path` and line range, the commit its lines are numbered at (`sha`), whether the host says the lines are no longer in the change (`isOutdated`), whether the thread is resolved when the host can tell (`isResolved`, absent otherwise), and its comments (author, Markdown `body`, instant, URL), oldest first. `ReviewThreadsView` is `{ kind: 'threads', threads, isTruncated }` or `{ kind: 'unsupported' }` for a session whose source has no threads (a local branch, a followed branch).
- **A port in main, adapters in domains.** `review:get-threads { sessionId }` is answered by `src/main/threads/`, which picks the first adapter whose `supports(source)` is true; an adapter is `{ supports, list }` over the session source. A host's adapter reads its API in its own domain (`src/internal/github/` now) and maps to the model there, so the renderer sees one shape whatever the host. Adding GitLab means a domain and an adapter, with no change to the channel or the renderer.
- **GitHub reads REST.** `GET /repos/{o}/{r}/pulls/{n}/comments`, up to ten pages of 100 (ADR 0035's client, so GitHub Enterprise Server works unchanged). Replies are grouped under their root by `in_reply_to_id`; threads are ordered by their first comment. A comment with a current `line` is placed at that line on the commit GitHub currently has it at (`commit_id`); one without it is outdated and keeps its `original_line` and `original_commit_id`. `LEFT` is the base side, `RIGHT` the head side; a comment on the whole file has no lines. Bodies are cut at 20,000 characters and are untrusted Markdown, handled as ADR 0110 handles review bodies.
- **Resolved state is not read.** GitHub's REST API doesn't say whether a thread is resolved; only GraphQL does, and ADR 0035 keeps the client REST-only. GraphQL also isn't below the REST root on GitHub Enterprise Server (`/api/graphql` beside `/api/v3`), which the client's path check refuses. So the GitHub adapter leaves `isResolved` out, the renderer shows every thread, and resolved filtering waits for the first adapter that can say it (or for a GraphQL path in the client, which would amend ADR 0035).
- **Optional, and off by default.** A display preference `showReviewComments` (View menu toggle and palette command, ADR 0068; stored in `settings.json` with the others, ADR 0042). While it is off nothing is read, so the setting costs no requests. The renderer reads threads when a pull request review loads and when polling reports a change (`github:pr-updated`, ADR 0038), as the timeline does, and drops an answer for another session or older than the latest read.
- **Placement.** A thread whose `sha` is the session head and whose lines are on the head side is drawn under its last line in the file card, among the card's other notes. A thread on the base side, an outdated one, one on another commit, or one on the whole file is listed at the top of the file's card instead, collapsed, so nothing is placed on lines it may not belong to. Re-anchoring other commits' lines to the head, as beuve does for its own notes (ADR 0023), is possible with the same line mapping and is left for later.
- **Read-only.** beuve shows threads and links each to its page on the host; it doesn't reply to or resolve them. Posting stays the reviewer's own review (ADR 0039).

## Consequences

- A reviewer can see what others said where they said it, and turn it off. The cost is one more paginated read per load and per change while the preference is on.
- Every thread shows, resolved or not, until an adapter can report resolution; a pull request with many old resolved threads is noisier than on GitHub.
- Threads outside the head's current lines are one click away rather than on the code. That is deliberate, not final.
- The host-neutral port costs one module in main and one channel more than a GitHub-only read would, in exchange for not having to change the renderer for the next host.

## Amendment 2026-11-20: threads are collapsed by default

ADR 0155: a thread under its lines shows one line (💬, its first comment's first line, its author, reply count and Resolved) and opens to every comment on Enter, Space or a click.
