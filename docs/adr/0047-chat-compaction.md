# 0047. `/compact`: a summary message as the chat's compaction boundary

- Status: Accepted; amends [0031](0031-read-only-qa-chat.md); queues instead of refusing since [0057](0057-chat-request-queue.md)
- Date: 2026-10-29

## Context

Each question resends the conversation (ADR 0031), bounded to 20 turns and 40 000 characters, oldest dropped first. Long reviews lose their early conclusions silently, and every question pays for the whole history. `/clear` throws everything away. Reviewers asked for a middle way: keep the gist, drop the bulk.

## Decision

- **`/compact`** (in the command registry, `/help` and the palette) calls `chat:compact { sessionId }`. Main takes the questions (with their mentions, ADR 0046) and completed answers since the last summary, refuses with `refused` when there are none, and asks the model through the same `ChatModel` port (read-only tools, head worktree, ADR 0030) to condense them, folding in the previous summary, into a short note with four bold labels: **Asked**, **Concluded**, **Open questions**, **Places**, the places as `[[path:start-end]]` citations (`compactConversation`, `buildCompactionPrompt`; 120 000 characters of turns, oldest dropped with a note). Citations are validated exactly like an answer's (ADR 0031): unknown paths become code and are dropped.
- **Storage.** `chat-0002` adds the role `summary` (complete, non-blank, citations, no mentions). The latest summary is the **compaction boundary** (`splitAtCompaction`): `toChatHistory` keeps only the turns after it, and the prompt gets a "Summary of the conversation so far" section (16 000 characters) before them. Messages before it stay stored and listed.
- **Lifecycle.** A compaction occupies the session like an answer (ADR 0032): questions are refused while it runs, `chat:cancel { sessionId }` stops it (the request now takes a `messageId` or a `sessionId`), and a head move, `/clear` or quitting aborts it; nothing is stored unless it completes. `chat:compact` answers when the summary is stored: `compacted` with the message, `cancelled`, or `failed` with the same codes and messages as answers.
- **Transcript.** The summary is a calm bordered block on the sunken surface, "Conversation summary", with citation pills. Everything before the latest summary folds under a "Compacted · N messages" divider, collapsed by default; expanding it shows the old messages dimmed. While it runs, a "Compacting the conversation…" line has Cancel. `/clear` still deletes everything, summaries included.
- **Suggesting, not doing.** When a completed answer's prompt dropped earlier turns, `chat:message-updated` carries `droppedTurns` and the drawer says once per session and window: "Older turns are being dropped — /compact to keep a summary." beuve never compacts on its own: it costs a model call and the reviewer should choose what the conversation becomes.

## Consequences

Long conversations stay cheap and keep their conclusions, and the reviewer can still read every original turn. A summary can be wrong or lose nuance; the prompt calls it the model's own, untrusted, and the turns after it are still sent verbatim. Compacting twice folds the first summary into the second, so information degrades with each pass. The summary costs one more model call and the same quota and privacy terms as a question.

## Amendment 2026-10-29: migrations squashed

Squashed into `chat-0001-initial` (ADR 0006); the schema described here is unchanged, and no upgrade step exists. The `summary` role is part of the original `chat_messages` CHECK.

## Amendment 2026-10-30: compaction queues

`/compact` waits its turn in the session's queue (ADR 0057) instead of refusing questions or being refused; questions asked while it runs are queued behind it. `chat:cancel { sessionId }` cancels it, running or waiting.
