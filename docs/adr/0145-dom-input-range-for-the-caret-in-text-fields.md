# 0145. `dom-input-range` measures the caret in text fields

- Status: Accepted; amends [0143](0143-emoji-shortcode-completion-in-note-fields.md)
- Date: 2026-11-18

## Context

The emoji list (ADR 0143) sat under the whole note field. Reviewers want it at the text caret, as GitHub's comment box does. `<input>` and `<textarea>` have no API for the box of a character: the known technique lays the field's text out in a hidden copy with the same styles and measures it there. We could write that ourselves, or take GitHub's code for it. GitHub's comment box uses `@github/text-expander-element`, which builds on `@github/combobox-nav` for keys and `dom-input-range` for the caret.

## Decision

- **Dependency:** `dom-input-range` 2.0.1 (MIT, Ian Sanders; portions from primer/react and component/textarea-caret-position), pinned exactly, no dependencies and no install script. Its `InputRange(field, start, end)` is a `Range`-like object over a field's text. Its `getClientRects()` measure a hidden clone, `InputStyleClone`, that copies the field's font, spacing, padding, borders, direction, size and scroll. It also centers an input's line vertically as the field does.
- **What we use:** only `InputRange` and the clone's `disconnect`, in one file. `caretRectFrom(field, offset)` (`src/ui/caret-rect-from.ts`) measures the `:` of the `:name` being completed, then disconnects the clone through a `DisposableStack`, so the clone is in the DOM (a hidden sibling after the field) only during the measurement and never lives past it. `caretAnchorFrom` (pure, tested) holds a character scrolled out of the field at the field's edge. `placeHoverCard` puts the list below that line, or above it near the window's bottom, and keeps it inside the window. A dependency-cruiser rule keeps `caret-rect-from.ts` the only importer.
- **Not `@github/text-expander-element`.** We asked for it first, with its keyboard handling turned off so ours stays in charge. Reading its source (2.9.4), almost nothing of it would have been left in use, and overriding it would have meant working against it:
  - Each field must be the light-DOM child of a `<text-expander>` wrapper, found once when the wrapper connects. The composer's and the dock's templates would change around every field.
  - It appends the menu we provide into itself and `remove()`s it when it closes, so it cannot be our Lit-rendered listbox. That listbox has to stay in the host's shadow root for `aria-activedescendant` (ADR 0143).
  - Its combobox (`@github/combobox-nav`) sets `role="combobox"` and `aria-expanded` on a `<textarea>`, which ADR 0143 leaves out because ARIA in HTML forbids it. It removes the role again on close, including the one an `<input>` carries statically. It also handles Enter, Tab, the arrows and, on macOS, Ctrl+N and Ctrl+P on the field and commits on a click in the list. Our capture-phase handler stops the keys it takes before they reach the field, but Ctrl+N/P (which we leave to the host) and clicks would still move or commit its selection alongside ours.
  - Its commit writes `input.value` directly, with no undo and no `input` event. We would cancel every `text-expander-value` and insert as we do now (`execCommand('insertText')`).
  - Its trigger matching is not `findEmojiQuery`, and it follows `input` only, not caret moves. It places the menu below the caret with physical `left`/`top` deltas, with no flip and no clamp to the window, so we would place the list again anyway.
- **Not our own mirror element.** It is the same technique in about the same amount of code. `dom-input-range` is maintained, used by GitHub, and covers cases we would rediscover (an input's centered line, the field's scrollbar narrowing the wrap width, RTL and vertical writing modes).
- **License:** npm dependencies carry their own license files (`THIRD_PARTY_NOTICES.md`), as `markdown-it-emoji` does. Nothing is copied into our source.
- It runs in the renderer under its strict CSP and Trusted Types (ADR 0077): it sets text with `textContent` and styles through the CSSOM, and writes no HTML.

## Consequences

The emoji list follows the caret and stays put while the name is typed. Measuring is synchronous and costs a style read and a layout of the field's text each time the list moves (typing, scrolling, resizing), only while it is open. A new caret-anchored popover reuses `caretRectFrom`. The clone's sibling insertion is the one DOM write outside our templates; it is undone before control returns, so Lit never sees it.
