# 0097. Language-server hover on tokens in diffs and sheets

- Status: Accepted
- Date: 2026-11-02

## Context

The reviewer reads code without an editor (spec 1), and the language server already answers
Go to Definition (ADR 0067). What a symbol _is_ (its type, signature, doc comment) is the next
thing a reviewer reaches for, and `textDocument/hover` answers it. The client already advertises
hover support and parses the `hoverProvider` capability (ADR 0016); nothing called it.

## Decision

- **Protocol**: `LspMultiplexer.hover` sends `textDocument/hover` and returns `HoverView`
  (`{ markdown, range }`) or `undefined`. `parseHover` reduces `MarkupContent`, `MarkedString` and
  arrays of them to one Markdown string (plain text and code-tagged strings become fenced blocks
  whose fence outgrows any backtick run inside; parts are separated by a rule), drops malformed
  parts, and cuts the text at 16 KiB. The range is converted to UTF-16 like every other range.
- **Channel**: `lsp:hover { sessionId, sha?, path, line, character }`, also allowed to sheet windows.
  It resolves its checkout exactly as `lsp:definition` does (the session head's, or a pinned
  commit's), so a sheet at an older commit hovers over that commit's text. `character` is
  required: a hover is about where the pointer is, and main never guesses a token. The answer is
  `{ sha, hover? }`; a file no server handles, a server without hover support or a file over the
  server's size limit answers no `hover` rather than an error, since a pointer rests on every
  kind of file. Real faults (a server that is not installed or crashed) are still `lsp-failed`.
- **Renderer**: diff cards (head-side tokens only, as for Go to Definition) and sheets report
  `onTokenEnter`/`onTokenLeave` from `@pierre/diffs` as `HoverPoint`s to one `beuve-hover-card`
  per window area (the app, and each sheet view). After the pointer rests 300 ms the card finds
  the character under it, asks main and shows the Markdown in a `popover="manual"` element in the
  top layer, placed by the pure `placeHoverCard`. Answers for a pointer that has moved on are
  dropped; the card closes on a click, wheel, scroll or blur outside it, and 150 ms after the
  pointer leaves both the token and the card.
- **Trust**: the text comes from a process reading repository content, so it is untrusted. It goes
  through the chat's `parseMarkdown` and `createMarkdownNodes` (element nodes only, no raw HTML),
  with fenced code as plain `<pre>`. Links are inert: the card cancels their clicks and opens
  nothing. No CSP or Trusted Types change is needed.

## Consequences

Hover costs one IPC round trip and one language-server request per rest, with no cache; a repeat
hover on the same character while the card is open is not asked again. Code in hovers is not
syntax-highlighted and links in doc comments are not followable; both can be added without a
contract change. Commit-pair (interdiff) cards report the same head-side lines as the card's
file, so a hover there answers for the review's head, not for the older commit shown.
