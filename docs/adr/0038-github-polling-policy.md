# 0038. Polling an open pull request session

- Status: Accepted
- Date: 2026-10-28

## Context

A pull request moves while it is reviewed: fixups, force-pushes, CI finishing. Spec 5F wants the interdiff offered when a pull request updates. GitHub has webhooks, but beuve is a desktop app with no public endpoint, so it has to poll, within a rate limit (5000 requests an hour, shared with the user's other gh use) and without spending requests on pull requests nobody is looking at.

## Decision

- **One session at a time**: main polls the pull request session the reviewer last opened (`session:open`, `session:get-review` or `github:get-pr` of a pull request; a local session stops polling). Opening a pull request polls at once.
- **Pace**: every 60 s while a beuve window has focus, five times less often while none does; regaining focus polls at once if the last poll is older than the interval. Timers are unref'd and stop on quit.
- **Conditional requests**: `getPullRequest` with the last ETag and `getCiStatus` with both ETags; a 304 costs no rate limit. The stack (`findPullRequestStack`, two list calls) is refreshed only when the pull request itself changed.
- **Failures**: a rate limit waits until `resetAt` (at least one interval, at most 15 minutes); any other failure doubles the delay up to 15 minutes; success resets it. A 401 invalidates the token that call sent and retries once (ADR 0034).
- **Head change**: fetch and verify as on open (ADR 0037), then `advanceHead`, which triggers the existing head-change behaviours: interdiff from the last checkpoint, review and chat runs aborted, URA items re-anchored and `ura:changed`. A head that couldn't be fetched drops the ETag, so the next poll asks again instead of being answered 304.
- **Pushes**: `github:pr-updated { sessionId, pullRequest, stack, headMoved }` whenever the pull request changed, `github:ci-status { sessionId, ci }` whenever CI changed. The renderer reloads the review on `headMoved` and says so in the status bar.

## Consequences

An idle focused session costs three conditional requests a minute, all 304s. CI and new commits show within a minute while the reviewer looks, within five otherwise. Only the open session is fresh; the session list shows the stored state of the others until they are opened. Pull requests updated while beuve is closed are caught on the next open.
