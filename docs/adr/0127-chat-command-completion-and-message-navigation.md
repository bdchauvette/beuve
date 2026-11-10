# 0127. Chat command completion, and moving through the transcript by message

- Status: Accepted
- Date: 2026-11-10

## Context

The chat input takes a dozen slash commands (ADR 0022, 0047, 0055–0057) that the reviewer had to remember or look up with `/help`. Long transcripts were hard to read back: the reviewer's questions were muted one-liners that disappeared between long answers, the only way through was the scroll bar, and every streamed delta pulled the view back to the end even while the reviewer was reading further up.

## Decision

- **Completion from the registry.** Typing `/` at the start of an input that holds only text lists the chat commands it could become, filtered by prefix as the reviewer types (case-insensitive), each with its `/help` line as a one-line description. The list is read from `commandRegistry`'s `slash` usages, as `/help` is, by `matchChatCommands`; there is no second list. A usage's alternatives (`split|inline`, `--effort=low|medium|high`) are offered once per choice, and a placeholder (`<path-prefix>…`) ends the inserted text for the reviewer to finish. So a new chat command gets completion by declaring its usage in that grammar, and a usage written any other way completes wrongly.
- **Keys** (`planChatCompletion`, catalog entry `chat-complete` for the shortcuts window): ↓ ↑ move the highlight, Tab chooses, Enter chooses the highlighted command, Escape closes the list until the input stops starting with `/`. While the typed text is not yet a command the first one is highlighted, so `/sum` Enter completes to `/summarize`; once it parses as a command nothing is highlighted, so Enter sends it as it does with the list closed. Choosing only types; a second Enter sends. These are plain keys in a focused text field, which ADR 0068 leaves to the renderer.
- **Not `beuve-menu`.** ADR 0115's menu opens from a trigger and moves focus into its items. A completion list must leave focus and the caret in the input, so it is a `listbox` the input points at with `aria-activedescendant`, rendered in the drawer's own shadow root (ids do not cross shadow roots). It borrows the menu's surface and highlight tokens.
- **Questions stand apart.** The reviewer's messages are a sunken block with an accent bar at the start, in the normal text color; answers keep their neutral bar.
- **Previous and Next Message** are catalog commands in the Chat menu (`previous-message`, `next-message`; Ctrl+Cmd+↑/↓ on macOS, Alt+Shift+↑/↓ on Linux), dispatched to the chat zone like the dock's commands. They scroll the transcript so the previous or next question, answer or summary starts at the top; a long answer read halfway goes back to its own start first. The chords are not `textConflict` because they are meant to work from the chat input. Sticky per-message headers were passed over: questions are short and answers have no header to stick, and a header per answer would cost a line of the narrow sidebar each.
- **Following the end.** The transcript scrolls to the end on new content only while it is scrolled to within a few lines of it; sending a question or opening another session's transcript follows the end again.

## Consequences

Commands are discoverable where they are typed, and adding one to the registry adds it to `/help`, the palette and the completion list together. The usage strings become a small grammar the completion relies on. Two more chords are taken. Previous and Next Message move by element tops, so they skip notes and command echoes, which are short.
