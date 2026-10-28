# 0039. Posting the URA as a GitHub review, and remembering what was posted

- Status: Accepted
- Date: 2026-10-28

## Context

ADR 0027 left the dock copying the GitHub review JSON because nothing could post it. Posting raises its own questions: which commit the comments refer to when items were written on several heads, which lines GitHub will accept inline, what the reviewer confirms before anything leaves the machine, what happens when GitHub refuses an approval on one's own pull request, and what a second post sends.

## Decision

- **Channels**: `github:preview-review { sessionId, verdict? }` compiles without posting and answers the counts (inline, in the body, already posted) and the head; `github:post-review { sessionId, verdict? }` posts. Both answer typed `failed` outcomes. The dock shows the preview as a confirmation step (Cancel / Post); nothing is posted without it.
- **What is posted**: the URA artifact on the current head with the session's verdict (chosen, else derived; `verdict` overrides it for this post), so items written against older heads are re-anchored and outdated ones go into the body (ADR 0023). `commit_id` is the current head, the one the placements refer to. `commentableRanges` come from the local `git diff base...head` (merge-base of the fetched base and the head), which is the diff GitHub shows, so items off the diff go into the body instead of failing the review.
- **Refusals**: GitHub's 422s go through `postPullRequestReview` with `onRejectedComments: 'move-to-body'` (a rejected comment is moved into the body and the review posted once more). `cannot-review-own-pull-request` becomes `own-pull-request`, and the dock asks "Post as comment instead?", reposting with `verdict: 'comment'`. `stale-commit` asks the reviewer to reload, and main polls at once.
- **Posted items**: a successful post records each carried item in `ura_item_postings` (migration `ura-0003-item-postings`: item, target `github`, session, review URL, head, `inline | body`, time; cascades with the item and the session). The item stays `staged`: being posted is a fact about it, not a resolution, and addressing or withdrawing it later works as before. Postings are excluded from the next post, so posting again sends only new items (or just a verdict). `ura:list` carries `posted` per item and the dock marks them. When the fallback moved comments into the body and GitHub didn't say which, all inline items are recorded as `body`.
- **Local sessions** keep "Copy GitHub review (JSON)"; pull request sessions replace it with posting. Signed out, the dock shows the `gh auth login` remedy instead of the button.

## Consequences

A review is all or nothing and never posted twice by accident. Editing a posted item doesn't repost it; the reviewer stages a new note to say more. If the review was created but the response was lost (network error), nothing is recorded and a retry posts again; GitHub shows both. The placement recorded for a partial body fallback can be wrong, which only affects the dock's tooltip.
