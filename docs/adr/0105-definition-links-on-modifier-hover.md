# 0105. Underline the definition link under ⌘/Ctrl-hover

- Status: Accepted
- Date: 2026-11-02

## Context

⌘/Ctrl-click on a token follows its definition (ADR 0067), but nothing on the text said which tokens would. The first attempt was a pointer cursor over the whole code area while the modifier was held, which marked every token, linked or not. VS Code and Zed instead ask the language server and underline the identifier only when it has a definition.

## Decision

- **Channel**: `lsp:definition` takes `link: true` (with `character`, which it then requires). Main probes only the identifier the pointer is on (`planDefinitionProbes` with `{ link: true }`: not one that ends just before the pointer, and not a keyword), skips the fallback to the enclosing symbol that a click uses, and drops targets that are the identifier itself, so a declaration is not a link. `targets` is empty when nothing links; `token` still says which identifier was asked about.
- **Renderer**: one `beuve-definition-link` per window area, next to `beuve-hover-card`, fed by the same token enter/leave events. It acts only while ⌘ (Ctrl elsewhere) is held, tracked from key events and the modifier state of pointer moves. After a short rest (60 ms) it asks, and for a yes underlines the server-confirmed identifier's range, not the highlighter's token element, which merges neighbouring text of one color. The token also gets a pointer cursor. A yes or a no stands for the whole identifier, so moving along it asks nothing more.
- **Drawing**: the underline is an overlay in the top layer that takes no pointer events, positioned from the text range's client rects. The library's DOM is untouched apart from the token's `cursor`. It clears with the modifier, the pointer leaving, a click, a wheel turn, a scroll or a blur.
- The always-on `data-jump` cursor and `trackJumpModifier` are removed.

## Consequences

A ⌘-hover costs one language-server request per identifier the pointer rests on, answered from the checkout the click would use. A click on an identifier that is not underlined still jumps, to the enclosing symbol as before. An identifier split across several highlighter elements is underlined only in the element the pointer is over. The server's text is not shown and the pointer cursor appears only on confirmed links.
