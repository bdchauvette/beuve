# 0119. Radix syntax palettes with muted keywords and punctuation

- Status: Accepted; amends [0025](0025-diff-cards-themes-and-lazy-mounting.md) (themes) and [0114](0114-design-tokens-logical-properties-and-diff-color-schemes.md) (attribution)
- Date: 2026-11-06

## Context

ADR 0025 copied Alabaster's hex values into `syntax-palettes.ts`. ADR 0114 then moved the rest of the UI onto Radix Colors, so code was the one surface whose colours came from somewhere else: `#f7f7f7` and `#0e1415` code backgrounds next to Radix slate and sage chrome, pure black text in light, and comment, string and constant hues that matched nothing in the token file. Alabaster's rule of four colored classes still holds. But with keywords, operators and punctuation in the same full-strength foreground as names, a dense line gives identifiers no more weight than `(`, `:` and `=>`.

## Decision

- **Radix steps, by role.** The palettes are Radix Colors 3.0.0 values, light and dark, picked by step role: background gray 2 (light) and gray 1 (dark), as for the chrome; text gray 12; strings green 11, constants purple 11, comments amber 11, definitions blue 11. Gray is slate in light and sage in dark, as in `index.css`. `--beuve-code-bg` and `--beuve-code-text` point at the same scale steps, and the sheet window's pre-paint background matches. The palettes stay hex strings, because the highlighter writes them as inline styles (ADR 0018).
- **Keywords, operators and punctuation are muted**, in gray 11 (Radix's low-contrast text step), so that names are the full-strength text on a line. This de-emphasizes syntax rather than emphasizing identifiers with bold or italics. Weight and slant change glyph shapes and, in some monospace fonts, widths, and they would compete with the diff's own line and word tints. It is also what Alabaster's original does, which ADR 0025 had not followed. The selectors are `keyword`, `storage`, `punctuation` and `meta.brace`, with three adjustments that keep the scope matcher honest:
  - Inside a comment or a string, a nested keyword, punctuation mark, brace or name (a JSDoc `@param` and its `{Type}`, a regex quantifier, a quote) keeps the comment's or the string's colour.
  - Inside a template literal's `${…}`, code is code again: keywords and punctuation are muted and constants keep their colour.
  - Go tags its built-in types (`int`, `error`, `string`) as `storage.type`; they stay plain, like TypeScript's `number` and Rust's `i32`.
- **Comments stay the emphasized class**, now in amber in both themes (Alabaster used red in light and yellow in dark). Amber 11 does not clash with the default scheme's red removed-line tint, and one hue across themes is easier to learn.
- **Attribution.** Nothing from Alabaster is copied any more. Its notice moves to "Drawn on" in `THIRD_PARTY_NOTICES.md`, and `syntax-palettes.ts` carries the Radix notice instead.

## Consequences

Code and chrome share one colour source, so a change of gray or accent scale in `index.css` has an obvious counterpart in `syntax-palettes.ts`, which must still be edited by hand. Muted punctuation is quieter at a glance but stays readable: gray 11 is Radix's step for secondary text. Amber is also the warning colour, so a warning tint on a comment reads as amber on amber; the squiggle still marks it. In the `blue-orange` scheme, amber comments sit on orange removed lines and blue definitions on blue added lines, as Alabaster's blue already did; step 11 on an a4–a5 tint stays legible, but the hues are close. Grammars that tag something unusual as `keyword` or `storage` get it muted too; the Shiki tests in `textmate-theme-from.test.ts` pin TypeScript, Go, Rust, Python and shell.
