# 0119. Syntax by weight and slant, with Radix colors

- Status: Accepted; amends [0025](0025-diff-cards-themes-and-lazy-mounting.md) (themes) and [0114](0114-design-tokens-logical-properties-and-diff-color-schemes.md) (attribution)
- Date: 2026-11-06

## Context

ADR 0025 copied Alabaster's palette: four colored classes (comments, strings, constants, definitions) and plain text for the rest, with no bold or italics. ADR 0114 then moved the rest of the UI onto Radix Colors, which left code as the one surface with colours from elsewhere. Code in beuve is read inside diffs, and the diff already uses colour, in line and changed-word tints, and in three schemes (ADR 0114). Syntax hues land on those tints: green strings on green added lines, blue definitions on blue in the `blue-orange` and `neutral` schemes. And with keywords, operators and punctuation at full strength, a dense line gives names no more weight than `(`, `:` and `=>`.

## Decision

- **Weight, slant and contrast carry the meaning; colour is nearly gone.**
  - _Definitions_ (functions, methods, classes, types, shell functions, Markdown headings) are **bold**: the grammars' `entity.name` scopes, with the use-site ones (calls, tags, commands, namespaces) taken back. Variable declarations are not bold. TypeScript marks them, but Python and Rust do not, so bolding them would hold in one language and not the next.
  - _Types_ (references, builtin types, inherited classes) are _italic_, which separates the type level from runtime code. A type's definition is **_bold italic_**.
  - _Numeric literals_ are **bold**, so magic numbers stand out. `true`, `null` and other constants are not.
  - _Names_ (variables, parameters, properties, property keys, calls), _operators_ and _strings_ are regular, in the full-strength text colour (Radix gray 12).
  - _Keywords and punctuation_ (`const`, `return`, `new`, `typeof`, brackets, separators, `.`, `::`, `=>`, a type annotation's `:`) are slightly muted, in gray 11.
  - _Comments_ are the one coloured class, in Radix amber 11, regular.
- **Every rule sets its font style.** An unset style inherits the enclosing scope's, so a rule that left it out would pick up italic inside a Python `def` line, or a definition's bold.
- **Grammar gaps, handled where cheap.**
  - Python scopes no annotation types beyond builtins. Everything else on a `def` line has a scope of its own, so whatever is left unscoped inside `meta.function` is italic. This misses annotations outside a `def` (`x: Foo = …`) and makes a default value that names a variable italic.
  - Go tags its builtin types as `storage.type`, so `source.go storage.type` is a type, not a muted keyword. Go's grammar scopes a type's definition and its uses the same way, so `type T struct` shows `T` italic but not bold.
  - Inside a comment or string, nested scopes keep the comment's or string's style: a JSDoc `@param {Item}`, a regex quantifier, a quote. Inside `${…}`, keywords and punctuation are muted again.
  - Rust's grammar calls `Widget` in `Widget::new(…)` a namespace inside a call, so it is a regular name there and an italic type elsewhere.
- **Radix values.** The palette is background gray 2 (light) or gray 1 (dark), as for the chrome; text gray 12; muted gray 11; comments amber 11. Gray is slate in light and sage in dark. `--beuve-code-bg` and `--beuve-code-text` point at the same steps, and the sheet window's pre-paint background matches. The palette stays hex, because the highlighter writes inline styles (ADR 0018).
- **Attribution.** Nothing from Alabaster is copied any more. It moves to "Drawn on" in `THIRD_PARTY_NOTICES.md`, and `syntax-palettes.ts` carries the Radix notice.

## Consequences

Syntax no longer competes with diff tints, in any scheme. Strings are told from names by their delimiters, not hue. Definitions keep Alabaster's main idea, standing out from uses, through weight instead of colour. If a class needs more, a colour can come back for it alone. Bold assumes a monospace font with a real bold of the same advance width; the system monospace fonts all have one. The tests in `textmate-theme-from.test.ts` pin the styles for TypeScript, Go, Rust, Python, shell and Markdown through Shiki, by style (`bold`, `italic`, `bold-italic`, `muted`, `plain`, `comment`).
