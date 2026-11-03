# 0105. Underline the definition link under ⌘/Ctrl-hover

- Status: Accepted
- Date: 2026-11-02

## Context

⌘/Ctrl-click on a token follows its definition (ADR 0067), but nothing on the text said which tokens would. The first attempt was a pointer cursor over the whole code area while the modifier was held, which marked every token, linked or not. VS Code and Zed instead ask the language server and underline the identifier only when it has a definition.

## Decision

- **Channel**: `lsp:definition` takes `link: true` (with `character`, which it then requires). Main probes only the identifier the pointer is on (`planDefinitionProbes` with `{ link: true }`: not one that ends just before the pointer, and not a keyword), skips the fallback to the enclosing symbol that a click uses, and drops targets that are the identifier itself, so a declaration is not a link. `targets` is empty when nothing links; `token` still says which identifier was asked about.
- **Module specifiers**: a path in an import (`from './auth'`, `import './x'`, `import('./x')`, `require('./x')`) is a link too: when the pointer is between its quotes, `findModuleSpecifier` makes the path the token, and the server is asked at its start, which answers the module's file. A click on it asks the same, so it follows the file the underline promised; before, it probed the line's identifiers and landed wherever the first call resolved. Strings elsewhere are not links.
- **Renderer**: one `beuve-definition-link` per window area, next to `beuve-hover-card`, fed by the same token enter/leave events. It acts only while ⌘ (Ctrl elsewhere) is held, tracked from key events and the modifier state of pointer moves. After a short rest (60 ms) it asks, and for a yes colors and underlines the server-confirmed identifier's range, not the highlighter's token element, which can hold neighbouring text such as `foo.bar`. The token also gets a pointer cursor. A yes or a no stands for the whole identifier, so moving along it asks nothing more.
- **Styling**: a CSS Custom Highlight (`CSS.highlights`, name `beuve-definition-link`) over a DOM range of the identifier's text, styled by one `::highlight()` rule in `index.css` (`--beuve-accent`, underline). A document rule reaches text inside the diff's shadow root (checked in Chromium), so the library gets no stylesheet and no markup from us, and the styling stays on the text through scrolling. The one change to the library's DOM is the token's inline `cursor`. It clears with the modifier, the pointer leaving, a click or a blur.
- The always-on `data-jump` cursor and `trackJumpModifier` are removed.

## Consequences

A ⌘-hover costs one language-server request per identifier the pointer rests on, answered from the checkout the click would use. A click on an identifier that is not underlined still jumps, to the enclosing symbol as before. An identifier split across several highlighter elements is styled only in the element the pointer is over. The pointer cursor and the color appear only on confirmed links. The highlight needs the Custom Highlight API (Chromium 105 or later in shadow roots; Electron 45 has it).
