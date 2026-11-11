# 0056. `/summarize`: beuve's own summary of the change, from the diff

- Status: Accepted
- Date: 2026-10-30

## Context

A reviewer's first question about a change is "what does it do, and where should I look". The pull request description answers it in the author's words, which may be stale, optimistic or written by the coding agent that made the change. The review-tools research's "blind first" caution applies here too: anchoring on the author's story makes the reviewer check less. A summary written from the code alone gives the reviewer a second reading to compare with the description.

## Decision

- **`/summarize`** (alias `/abstract`) is a chat request (`command: { kind: 'summarize' }`), stored as an assistant message of `kind = 'abstract'`, queued like any question (ADR 0057). It runs the chat's prompt builder with an `abstract` task: the bounded diff and the head worktree (read-only tools, as for questions), no history, no focus, no ImpactGate findings and **no stated intent**: main does not pass the pull request title and body, and the prompt says on purpose that no description is given. Mentioning what the author says is left to the description itself, beside the summary in the Files tab.
- **Shape**: concise Markdown with four bold labels: **What changed** (behavior, not a file-by-file restatement), **Why** (starting with "Inferred:", since it is the model's reading), **Risky areas** and **Files by purpose**, with `[[path:start-end]]` citations validated like an answer's (ADR 0031). It streams like an answer.
- **Transcript**: a calm bordered block on the surface colour, labelled "Summary of the change · from the diff", with citation pills and the usual "Stage as URA comment", which stages it as a `question` note titled "Summary of the change (beuve, from the diff)" anchored like any answer (ADR 0032).

## Consequences

The summary can be wrong, and "Inferred:" says so; it costs one model call like a question. Because it never sees the description, it can't be steered by instructions planted there, but it also can't use a genuinely helpful description; the reviewer has both side by side.

## Amendment 2026-11-11: no stage button

The summary block has no "Stage as URA comment" any more (ADR 0134).
