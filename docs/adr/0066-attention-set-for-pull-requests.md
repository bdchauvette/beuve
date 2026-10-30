# 0066. An attention set for pull request sessions

- Status: Accepted
- Date: 2026-10-30

## Context

Critique and Gerrit tell each participant whose turn a change is, with a reason on hover. beuve already polls the open pull request (ADR 0038) and knows its CI, so a reviewer opening a pull request can be told whether the next move is theirs, the author's or other reviewers'. The UI chip comes later; this is the backend.

## Decision

- **A pure rule function.** `attentionFrom` (github domain) maps `{ viewer, author, state, isDraft, headSha, requests, reviews, ci, failingChecks }` to `{ turn: 'you' | 'author' | 'reviewers' | 'unknown', reasons }`. Rules, in order:
  1. Closed or merged: `unknown`.
  2. The author's turn: the pull request is a draft; a reviewer's latest decision is "changes requested" on the current head (the author has not pushed since); CI is failing on the head.
  3. Otherwise the reviewers': a review was requested from a user or team (GitHub re-requests after a push, so this covers re-review), or a reviewer who requested changes has a head the author pushed to since.
  4. Otherwise `author` (ready to merge) when a reviewer's latest decision is an approval on the current head and CI passes; else `unknown`.
     The author's turn reads `you` when the viewer is the author. The reviewers' turn reads `you` when the viewer is one of the requested reviewers or a reviewer owed a re-review (never through a team, whose members are not known). Reasons list the decisive one first and then the other side's.
- **A reviewer's decision is their latest approval, change request or dismissal.** Comment-only reviews change nobody's turn, a dismissed review no longer counts, and the author's own reviews are ignored.
- **Data.** Beside the pull request the poller already fetches, it reads `GET …/pulls/{n}/reviews` (paged) and `GET …/pulls/{n}/requested_reviewers` whenever the pull request changed, and the signed-in login from the credential provider's `describe` once. CI comes from the status the poller already holds, used only while it is about the current head. No new polling: a review, a request or a push changes the pull request's `updated_at`, which its ETag already watches.
- **Unresolved review threads are not read.** Their resolved state exists only in GraphQL, which beuve's REST client (ADR 0035) does not speak; the rules will take them as one more author reason if that changes.
- **Contract.** `github:pr-updated` gains an optional `attention`, and so does `github:get-pr`'s `PullRequestSessionView`. `github:pr-updated` is also pushed (with `headMoved: false`) when CI finishing changes the attention. `attention` is absent until the reviews were read once; a failed read keeps the last answer and is logged.

## Consequences

The chip can render without any further requests, and every rule is a table-testable function. Two more requests (one when a pull request has many reviews) follow each change of the open pull request. The turn is a heuristic: a reviewer who requested changes in prose, review threads without a state, and merge-queue rules are invisible to it, so reasons stay visible and the turn is never used to gate anything.
