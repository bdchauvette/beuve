# 0126. Highlight other occurrences of the selected text

- Status: Accepted
- Date: 2026-11-10

## Context

Reviewers asked for what editors do: select some text in a diff or a sheet, and see where else it occurs in the code on screen. The code is rendered by `@pierre/diffs` in a shadow root whose DOM beuve does not own and must not write HTML into (ADR 0077); diagnostics (ADR 0111) and the definition link (ADR 0105) already paint over it with CSS Custom Highlights instead. A language server could answer `textDocument/documentHighlight` for a symbol, but only on the head side of a file it has open, through an IPC round trip per selection, and it would not cover the base side, plain text or files without a server.

## Decision

- **Plain text, not the language server.** The selection's own text is looked for, case-sensitively, with no request to main. It counts only when it lies inside one code row (`code [data-line]`) of a code view, has at least two non-whitespace characters, is at most 200 characters long and has no line break (`selectionNeedleFrom`). A selection that is a whole word (letters, digits, `_` or `$`, with no word character just outside it) matches only whole words; anything else matches anywhere (`needleOffsetsIn`). `textDocument/documentHighlight` is left out; it can be added later as a second source for a symbol under the cursor.
- **One CSS Custom Highlight**, `beuve-selection-match`, at priority 0 so diagnostics paint above it, styled in `index.css` with `--beuve-code-selection-match` (a gray alpha step, fainter than the selection). Nothing is added to the library's DOM.
- **Per container.** A `SelectionMatches` controller on the diff stream (every card's code root) and on the sheet view (its code root) listens to `selectionchange` while connected, released through a `DisposableStack` (ADR 0076), waits 120 ms for the selection to rest, then scans only the rows the library has rendered (cards out of view are not mounted, ADR 0025), painting at most 500 occurrences. Each container adds and takes out only its own ranges. Chat snippets and rich views get none.
- **No preference.** It is always on, as in editors; a toggle would be a menu item (ADR 0068) if one is ever wanted.

## Consequences

It is cheap, works on both sides of a diff and on files no language server knows, and needs no IPC. It matches text, not symbols: selecting `id` finds every standalone `id`, including unrelated ones. Rows rendered after the scan (a card scrolled into view, an expanded hunk) are not highlighted until the selection changes.
