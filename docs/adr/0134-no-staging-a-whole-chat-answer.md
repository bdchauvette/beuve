# 0134. A chat answer is never staged whole

- Status: Accepted
- Date: 2026-11-11

## Context

Every completed answer, and every `/summarize` block, carried "Stage as URA comment" (ADR 0032, 0056), with a matching Stage Answer as a Note on the answer's context menu (ADR 0068). It staged the whole answer as a `question` note titled with the question. An answer is written for the reviewer, not for the author: it explains, hedges and cites, and nothing about it reads as a review comment. Since ADR 0132, an answer can propose notes that are written for the author, each on its own lines, and `/review` findings stage one by one (ADR 0055). The whole-answer button competed with those on every answer and was never the right thing to press.

## Decision

- Answers and `/summarize` blocks have no stage button; the `stage-answer` command and the `answer` context-menu kind are gone. What reaches the dock from the chat is a `/review` finding or a proposed note, each one the reviewer's click.
- `ura:create` loses `origin`: a note made through it is always the reviewer's (`human`). A `chat-answer` origin names a finding or a proposal, never neither: `validateUraItem` rejects one that names neither, and the `ura_items` CHECK says the same (`chat_finding` or `chat_proposal`, exactly one, on lines).
- To quote an answer in a note, the reviewer copies from it into the composer.

## Consequences

The answer footer is quieter, and the chat has one way to stage, proposals, beside findings. `planChatStage`, `UraController.stageChatAnswer` and `stagedMessageIds` are removed. This supersedes the staging rule of ADR 0032, the stage button of ADR 0056 and the chat-answer context menu of ADR 0068.
