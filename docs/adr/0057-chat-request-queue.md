# 0057. Chat requests queue per session in main

- Status: Accepted; supersedes the "refused, not queued" rule of [0032](0032-chat-wiring-one-answer-per-session.md), amends [0047](0047-chat-compaction.md); statuses and channels amended by [0072](0072-chat-message-parts-and-stream-protocol.md)
- Date: 2026-10-30

## Context

ADR 0032 refused a question asked while another streamed, so the reviewer had to wait and resend. With `/review` and `/summarize` now chat requests (ADR 0055, 0056), a reviewer naturally types a follow-up while a minutes-long review runs. The refusal's reasons were quota spent on stale questions and an invisible order; both can be answered by showing the queue and making it cheap to empty.

## Decision

- **Main queues** (`KeyedQueue` in `#x/collections`): per session, first in first out, one request running, at most 10 waiting; more is `refused` ("10 requests are already waiting…"). Questions, `/review`, `/summarize` and `/compact` share the queue. Intake is serialized, so requests are queued in the order they were made even when their head refresh or mention reads take different times.
- **Storage**: `chat:ask` stores the question and its answer at once, the answer `streaming` when the session is idle and `queued` otherwise (a new status of `chat_messages`). When a queued answer starts, main stores `streaming` and pushes `chat:message-updated`; its history is the stored conversation before its question, so a queued follow-up sees the answers that ran before it.
- **Cancel** (`chat:cancel { messageId }`) stops only that request: a running one is aborted (what streamed is kept), a queued one is taken out and stored as `cancelled` with no text. `chat:cancel { sessionId }` now targets the session's `/compact`. The rest of the queue goes on.
- **Clearing**: `/clear` (`chat:clear`) stops the running request, empties the queue and deletes the transcript; `/clear queue` and the transcript's "Clear queue" button (`chat:clear { queuedOnly: true }`) delete only the waiting questions and their answers. A head move stops the running request and cancels the waiting ones asked at the old head; quitting stops all. A `queued` or `streaming` row with no job behind it (the app died) is shown, and stored, as `cancelled`.
- **UI**: mostly unaware. A queued question shows a subtle "queued" and a small Cancel after its text, its answer appears when it starts, the input's placeholder says "Ask; it waits its turn", and a line under the transcript says "n waiting · Clear queue". `/compact` waits its turn too, with its usual "Compacting…" line.

## Consequences

The reviewer never resends a question. Queued requests still cost quota when they run, so the queue is bounded and visible, and emptying it is one click. The order is the reviewer's, not completion order of their IPC calls.
