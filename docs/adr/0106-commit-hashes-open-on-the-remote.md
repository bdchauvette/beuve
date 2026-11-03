# 0106. Commit hashes in the review header open on the remote

- Status: Accepted
- Date: 2026-11-03

## Context

The review header shows the commits the diff spans as short shas (`fork..head`, or `last reviewed head..head` for an interdiff). They were plain text, so reaching the commit on GitHub meant copying a sha out of the tooltip. ADR 0067 already opens file permalinks on the session's primary remote, built in main so the renderer never names a URL.

## Decision

- **Each sha in the header is a button.** Clicking the base (or last reviewed head) or the head asks main to open that commit's page.
- **`remote:open-commit { sessionId, sha }`** (main window only, not the sheet allow-list). `sha` must be a full commit name of the session's repository, checked as for sheets (`resolveSheetCommit`). Main picks the primary remote as for permalinks (ADR 0067: the pull request's base repository, else `origin`, else the first GitHub remote), builds `https://<host>/<owner>/<repo>/commit/<sha>` (`commitLinkFrom`, owner and repository percent-encoded), and opens it with `shell.openExternal`. It answers `no-remote` without a GitHub remote, which the header shows as a notice.
- The permalink and commit links share one path in `create-remote-services.ts`, so both get the same commit check and remote choice.
- It is not per-head: the link is pinned to its own `sha`.

## Consequences

A reviewer can jump from the header to either end of the range in one click. A commit that was never pushed, or a last reviewed head that was force-pushed away, answers an error notice or a 404 on GitHub; the link is only as good as the remote's copy. One more channel is in the main window's surface; the sheets cannot call it.
