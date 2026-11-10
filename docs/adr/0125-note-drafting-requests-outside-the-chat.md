# 0125. Note drafting requests run outside the chat

- Status: Accepted; amends [0055](0055-review-folded-into-chat-with-verification.md) ("every model call is a chat request")
- Date: 2026-11-10

## Context

The reviewer wants help writing review notes: "expand on this" (turn a terse idea into a note the author can act on), and later "review my review" (catch questions the code already answers) and "summarize my review" (an opt-in summary for the top of the posted review). ADR 0055 made every model call a chat request: queued per session (ADR 0057), stored in `chat_messages`, and built from the conversation, its mentions and its focus.

That is the wrong home for drafting. A note is written for the author of the change, who never sees the reviewer's chat; a prompt built from the chat would carry its context (earlier questions, half-formed theories, beuve's own findings) into text the author must understand without it. Running drafts through the chat would also put requests that aren't questions into the transcript and behind a minutes-long `/review` in the queue, and every later question would see them as history.

## Decision

- **Drafting is a one-off model request**, outside the chat: one IPC request per draft (`ura:expand-note` first), answered with the text or a typed failure. Nothing is stored and nothing joins the chat queue or its history. It is cancellable with `request:cancel`, like `github:open-pr`, and a new request for the same note replaces one in flight.
- **Its context is the change and the draft, nothing else.** The prompt holds the note's severity, title and body, its anchor, and the diff hunks of the anchored file that touch or neighbour the anchored lines (or the file's own hunks for a file note, a bounded slice of the diff for a whole-change note), at the note's head, bounded like the chat's diff. Diff and draft are fenced as untrusted (`fenceUntrusted`). It never includes the chat transcript, other notes, beuve's findings, the pull request's description (as for `/summarize`, ADR 0056) or the reviewer's mentions.
- **No repository access.** The run gets a scratch directory as `cwd` (as Settings' Test does) and no `tree`, so a checkout-reading adapter has nothing to read and the answer can only lean on what the prompt shows. The note is about the lines on screen; reading the repository would invite claims the author cannot check against the diff.
- **The model** is resolved by a new role, `draft` (ADR 0070's per-role models), which falls back to the default entry like the others; effort `low` and a two-minute timeout by default.
- **The instructions**: write the note for the change's author, in the reviewer's voice and language; keep the reviewer's point and severity; add only what the shown code supports; never invent a problem, mention a tool, a model, a chat or anything outside the shown diff; return only the note's Markdown body.
- **The reviewer decides.** The result replaces the body field's text as an ordinary edit the reviewer can undo or rewrite; it is never staged, saved or posted by itself. The title and severity stay the reviewer's.
- **Later drafting requests** ("review my review", "summarize my review") follow the same rules, each with its own channel and its own narrow context; each is added when it is built.

## Consequences

- CLAUDE.md's rule "every model call is a chat request" gains this exception: note drafting. Anything else that talks to a model still goes through the chat.
- A draft costs a model call that leaves no trace in the transcript, so the reviewer can't scroll back to it; the text lives only in the note.
- Without repository access the model can misread code it only sees in a hunk; the reviewer reads the result before staging, as with anything beuve writes for them.
- A second request path to the model means a second place to keep the adapter's failures readable; it reuses the chat's `describeModelError`.

## Amendment (2026-11-10): as built

- The diff is the whole change at the note's head (fork point to `headSha`), not the review's interdiff, so a note on an older head or a reviewed-up-to-date session still sees its hunks. A line note gets its file's hunks within 20 lines of the anchor (the nearest one when none is), nearest first while they fit half the chat's prompt budget; the prompt builder and the selection are in `src/internal/chat` (`build-note-draft-prompt.ts`, `select-note-hunks.ts`) because they share the chat's fencing and budgets; nothing there touches the chat's queue or tables. Main's side is `src/main/drafting/`.
- The renderer names a note's requests `expand-note:<note>` (the composer's is `new`), and main supersedes a `note-draft` scope only by the same `requestId`, so the composer and an edit form can expand at once.
- The forms' Expand is `beuve-note-expand`, which asks with a composed `beuve-note-expand-request` that `beuve-review` answers; it replaces the body by selecting it and inserting the text (`execCommand('insertText')`), which keeps Chromium's undo stack. Review ▸ Note ▸ Expand Draft (`expand-note`, no chord) runs the Expand of the note form last focused.
