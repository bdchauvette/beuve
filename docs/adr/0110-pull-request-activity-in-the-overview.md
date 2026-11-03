# 0110. Pull request activity in the Overview

- Status: Accepted
- Date: 2026-11-03

## Context

ADR 0109 gave pull requests an Overview tab holding the description and CI checks. A reviewer joining a pull request halfway also wants its history: what was pushed, what the other reviewers said, and what the conversation settled. beuve showed none of it (the poller reads reviews only to say whose turn it is, ADR 0066).

## Decision

- **`github:get-timeline { sessionId }`** reads a pull request session's history, oldest first: its commits (`GET …/pulls/{n}/commits`), its submitted reviews (`…/pulls/{n}/reviews`) and the comments of its conversation (`…/issues/{n}/comments`), each list up to ten pages of 100, read in parallel. The answer is `{ kind: 'timeline', events, isTruncated }`, or the usual GitHub failure. `getPullRequestTimeline` is in the github domain; `timelineFrom` merges the lists by instant, commits before reviews before comments at the same instant. The channel names a session, not a head: it is a read of GitHub, which belongs to the pull request (listed as such in the per-head channel test).
- **What is left out.** Pending reviews (only their author sees them), review states GitHub may add later, and reviews that carry only line comments with no words of their own. Comments on lines of the diff are not read: they belong to their review threads, and the review body already says what the reviewer concluded.
- **Untrusted text.** Review and comment bodies are cut at 20,000 characters in the domain and rendered as Markdown through text nodes only (ADR 0073), in a capped, scrolling `.body`; links go through `beuve-open-link`, which main checks against GitHub's own hosts (ADR 0040). The renderer never names a URL it did not get from the API, and a commit or time opens the event's own `html_url`.
- **Overview.** `beuve-pull-request-timeline` lists the events under the description and the checks: a dot (green for an approval, red for a request for changes, amber for a dismissed review), who, what they did, when (a relative time that opens the event on GitHub), and the words they wrote or the commit headline and short sha. Only the latest 100 events are drawn.
- **Freshness.** The window reads the timeline when a pull request review loads and again whenever polling reports a change (`github:pr-updated`, ADR 0066), keeping the list on screen while it refreshes. A late answer for another session, or older than the latest read, is dropped. A failure is shown in place of the list, as GitHub's own message.

## Consequences

The Overview tells the story of a pull request without leaving beuve. Opening a pull request costs three more REST calls, and so does each poll that finds a change. Inline review comments are not shown, so a reviewer who wants the threads still opens GitHub. A pull request with more than 1,000 commits, reviews or comments reads only the first 1,000 of each and says so.
