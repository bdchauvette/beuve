# 0032. Chat wiring: one answer per session, refused not queued; staging and persistence rules

- Status: Partly superseded by [0057](0057-chat-request-queue.md) (requests queue instead of being refused); completes [0031](0031-read-only-qa-chat.md) (a compaction occupies the session too, [0047](0047-chat-compaction.md))
- Date: 2026-10-28

## Context

ADR 0031 left some questions of the main and UI wiring open: what happens to a question asked while an answer streams, what a stored `streaming` message means after a crash, how often the preview is written, where a staged answer anchors, and how the drawer reaches pills by keyboard now that Tab cycles zones.

## Decision

- **Channels**: `chat:ask { sessionId, question, focus?: { path, line? } }` (question trimmed, 1 to 8000 characters) answers with `{ question, answer }` messages, the answer `streaming`. `chat:list`, `chat:cancel { messageId }` and `chat:clear { sessionId }` wrap the repository. Pushes: `chat:delta { sessionId, messageId, kind, text }` and `chat:message-updated { message }`. Failures are `failed` messages with a code (`not-installed`, `not-authenticated`, `rate-limited`, `timeout`, `model-failed`, `chat-unavailable`, `internal`); main turns the code into the message the drawer shows. A cancellation, a head move and quitting end as `cancelled` and keep what streamed.
- **One answer per session, refused, not queued.** A question asked while one streams gets the `refused` error ("An answer is still streaming. Cancel it or wait…"), which the drawer shows as a note. A queue would spend quota on questions the reviewer may no longer want, and its order would be invisible. Cancel is one click. `chat:clear` frees the session at once and the aborted answer stores nothing.
- **Persistence**: the streaming preview is stored at most once a second, from the delta handler, never on a timer. The final state is always stored before `chat:message-updated` is pushed. A `streaming` row with no job behind it (the app died) is shown, and stored, as `cancelled` the next time the session's chat is listed.
- **Context**: the diff is `session:get-review`'s, whatever the scope, with no path scope. ImpactGate findings come from `session:get-impact`, computed if not yet cached. The head's tracked paths (`git ls-tree`) are the citable worktree files. The focus is the file under the diff stream's cursor.
- **Staging** (`ura:create` takes an optional `origin: { kind: 'chat-answer', messageId }`): the note is a `question` titled with the question (one line, 100 characters), whose body is the answer with each marker written as `` `path:start-end` ``. The anchor is the first citation inside the reviewed diff, else the whole change, because exporters place notes on diff lines. A citation to another file stays in the body and as a pill.
- **Pills and keys**: a pill for a file in the diff jumps the diff stream to its first line. For another file at the head it says the file isn't in the diff. Pills and the answer's buttons are reached with the arrow keys (Up from the input, Up/Down between them, Down from the last to the input, Escape to the diff), since Tab cycles zones. Tab and Shift+Tab typed in the chat input cycle zones too; the shell ignores keys typed in inputs, so the drawer asks for the cycle.
- **Renderer state**: events can beat the `chat:ask` response, so deltas and the final state for an unknown message wait and are replayed when it lands (`reduceChatTranscript`). A reloaded history keeps an answer streaming in this window.

## Consequences

- A reviewer who types a second question too early has to resend it. The refusal says why.
- A crash can leave an unfinished answer shown as stopped, with the text up to the last stored preview.
- An answer whose only citations are outside the diff stages on the whole change, which the dock shows.
- `ura:create` accepts a `chat-answer` origin from the renderer; the message id isn't checked against `chat_messages`, because the URA domain doesn't know the chat domain's table.

## Amendment 2026-10-30: queued, not refused

ADR 0057 replaces "one answer per session, refused, not queued": a question asked while another runs is stored `queued` and runs in its turn, and Cancel stops only that one. The persistence, staging, pill and renderer-state rules stand; a `queued` row with no job is settled as `cancelled` like a `streaming` one.

## Amendment 2026-11-11: no whole-answer staging

ADR 0134 removes the Staging rule: an answer is never staged whole, and `ura:create` has no `origin`. The chat stages `/review` findings (ADR 0055) and proposed notes (ADR 0132) instead.
