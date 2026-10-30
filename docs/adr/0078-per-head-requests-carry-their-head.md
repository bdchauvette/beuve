# 0078. Per-head requests carry a required head SHA, and main uses only it

- Status: Accepted
- Date: 2026-10-30

## Context

A review is about one head. The poller (ADR 0038) moves a pull request session's head whenever the author pushes, so the head the reviewer read and the head main reads when a click arrives can differ. `github:post-review` and `ura:set-verdict` carried no head at all. Main read the head once in `prepareGithubReview` and again when it compiled the artifact, and the second read became `commit_id`. The post dialog stayed open across a head move, and with nothing blocking staged the derived verdict is approve. So a push while the dialog was open made Post approve a commit nobody had read, after the push, which GitHub's "dismiss stale approvals" doesn't catch. An explicit Approve was likewise stamped with whatever head was stored, not the one on screen. `session:mark-reviewed` and `review:set-file-reviewed` had the guard, but only when the caller sent a head.

## Decision

- **Every request that changes or publishes state belonging to one head carries a required `expectedHeadSha`**: the head the reviewer was shown. Today these are `session:mark-reviewed`, `review:set-file-reviewed`, `ura:set-verdict`, `github:preview-review` and `github:post-review`, listed in `src/contract/per-head-invoke-channels.ts`. The IPC schemas reject a request without it.
- **Main checks it against the session's stored head before doing anything.** A mismatch is expected, so it is a `Result`, not an exception: `head-moved` (a `GithubFailureView`) for the GitHub channels, `stale-review` for the others. Nothing is posted or stored.
- **Main then uses that one SHA for the whole operation and never reads the head again.** `prepareGithubReview` passes it to `refreshSession` (`headSha` option) and to `compileArtifact(sessionId, { headSha, verdict })`, so the commentable ranges, the artifact, `commit_id`, the preview and the recorded postings all come from it, even if the poller moves the head in the middle. A verdict choice is honoured only if it was made at that head. GitHub anchors the review to `commit_id`, so if GitHub's PR head has already moved and the poller hasn't seen it yet, the review still lands on the reviewed commit. `ura:set-verdict` stamps the choice with `expectedHeadSha`.
- **One post per session at a time.** Main refuses a second `github:post-review` while one is in flight (`refused`), and the dock shows no Post button while it waits.
- **The renderer voids what a head move makes stale.** A confirmation or own-PR offer gives way to the quiet note "The PR changed since you opened this; review the new commits first." when the session's head changes or main answers `head-moved`, and the review reloads.
- **The contract test keeps it so.** `per-head-invoke-channels.test.ts` checks at the type level that each listed channel's request has a required `expectedHeadSha: string`, and makes every other channel whose request takes a `sessionId` give, in an exhaustive record, the reason it needs no head. A new session channel doesn't compile until it is classified. `create-ipc-handlers.test.ts` checks at run time that each listed channel rejects a request without its head.

## Consequences

A review, approval, verdict or mark always describes the head the reviewer saw, or nothing happens and the reviewer is told to look at the new commits. Callers can't skip the guard by leaving the field out. Reads, and writes that record their own head (`ura:create`'s `headSha`, chat answers, ImpactGate findings), stay head-free; the test records why for each. The base is not pinned yet: a base branch fetched between prepare and compile can still change the fork point the artifact names (pinned since ADR 0079). `lsp:call-hierarchy` is a read of the stored head and is listed as such; pinning it to a `sha` is separate work. This supersedes ADR 0045's "stamps the choice with the session's stored head" and makes ADR 0064's `expectedHeadSha` required.
