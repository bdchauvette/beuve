# 0119. Syntax by weight and slant, with Radix colors

- Status: Accepted; amends [0025](0025-diff-cards-themes-and-lazy-mounting.md) (themes) and [0114](0114-design-tokens-logical-properties-and-diff-color-schemes.md) (attribution)
- Date: 2026-11-06

## Context

ADR 0025 copied Alabaster's palette: four colored classes (comments, strings, constants, definitions) and plain text for the rest, with no bold or italics. ADR 0114 then moved the rest of the UI onto Radix Colors, which left code as the one surface with colours from elsewhere. Code in beuve is read inside diffs, and the diff already uses colour, in line and changed-word tints, and in three schemes (ADR 0114). Syntax hues land on those tints: green strings on green added lines, blue definitions on blue in the `blue-orange` and `neutral` schemes. And with keywords, operators and punctuation at full strength, a dense line gives names no more weight than `(`, `:` and `=>`.

## Decision

- **Weight and slant carry the meaning; colour is nearly gone.**
  - _Names_ (variables, parameters, properties, functions, calls, definitions) are **bold**.
  - _Types_ (type references and definitions, builtin types, inherited classes) are _italic_. This separates the type level from runtime code. A type is not also bold.
  - _Keywords and punctuation_ (`const`, `return`, `new`, `typeof`, brackets, separators, `.`, `::`, `=>`, a type annotation's `:`) are muted, in Radix gray 11.
  - _Operators, strings and constants_ are regular weight in the text colour.
  - _Comments_ are the one coloured class, in Radix amber 11, regular. Italic is taken by types.
- **Bold is the default for a whole `source` scope.** Grammars leave many names unscoped (Python's locals and call arguments, Rust's fields), so a list of identifier scopes would miss them. Every other class sets its font style explicitly, because an unset style inherits the enclosing scope's. Named scopes (`entity.name`, `variable`, `support.function`, …) are bold explicitly too, so they stay bold inside an italic Python `def` line or a string's interpolation. Markdown prose and plain text are `text` scopes and stay regular. Headings, tag names and YAML keys are names and bold.
- **Grammar gaps, handled where cheap.**
  - Python scopes no annotation types beyond builtins. Everything else on a `def` line has a scope of its own, so whatever is left unscoped inside `meta.function` is italic. This misses annotations outside a `def` (`x: Foo = …`) and makes a default value that names a variable italic.
  - Go tags its builtin types as `storage.type`, so `source.go storage.type` is a type, not a muted keyword.
  - Inside a comment or string, nested scopes keep the comment's or string's style: a JSDoc `@param {Item}`, a regex quantifier, a quote. Inside `${…}`, code is code again.
  - Rust's grammar calls `Widget` in `Widget::new(…)` a namespace inside a call, so it is a bold name there and an italic type elsewhere.
- **Radix values.** The palette is background gray 2 (light) or gray 1 (dark), as for the chrome; text gray 12; muted gray 11; comments amber 11. Gray is slate in light and sage in dark. `--beuve-code-bg` and `--beuve-code-text` point at the same steps, and the sheet window's pre-paint background matches. The palette stays hex, because the highlighter writes inline styles (ADR 0018).
- **Attribution.** Nothing from Alabaster is copied any more. It moves to "Drawn on" in `THIRD_PARTY_NOTICES.md`, and `syntax-palettes.ts` carries the Radix notice.

## Consequences

Syntax no longer competes with diff tints, in any scheme. Strings and constants are told from names by weight and their delimiters, not hue, and definitions look like uses, which is Alabaster's main idea given up. If either is missed, a colour can come back for that class alone. Bold assumes a monospace font with a real bold of the same advance width; the system monospace fonts all have one. The tests in `textmate-theme-from.test.ts` pin the styles for TypeScript, Go, Rust, Python, shell and Markdown through Shiki, by class (`name`, `type`, `muted`, `plain`, `comment`).
