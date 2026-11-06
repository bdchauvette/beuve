# 0118. CSS is linted by `@eslint/css`, Lit templates included

- Status: Accepted; amends [0114](0114-design-tokens-logical-properties-and-diff-color-schemes.md) (overflow)
- Date: 2026-11-06

## Context

ADR 0114's local rules hold the renderer's CSS to the design tokens and to logical properties, but nothing checked that the CSS is valid: a misspelt property, a value its property does not take, an at-rule in the wrong place, a selector that can never match. `src/ui/index.css` was not linted at all. Stylelint was tried against the code. It needs about 130 packages and `postcss-lit`, which parses every file with Babel, chokes on one of ours and turns composed style modules into false positives. Its standard set also mostly enforces formatting, which Prettier already owns. ESLint's own CSS language, `@eslint/css`, validates properties and values against the CSS grammar, ships `prefer-logical-properties`, and adds one package to the tree. It lints only CSS files, though, and the renderer's CSS is in Lit `css` templates.

## Decision

- **`@eslint/css` 2.0.1**, pinned exactly (three weeks old when added), lints every `.css` file through the `beuve/css` config block. It uses the recommended rules plus `prefer-logical-properties`, with three settings. Unknown variables are allowed, because a template cannot see the tokens in `index.css`. `use-baseline` is off: beuve runs on one Chromium, Electron's, so cross-browser availability does not apply. `font-family-fallbacks` is off, because it cannot see a fallback through `font: var(--beuve-font-body)`. Electron's `-webkit-app-region` is declared through `customSyntax`, since no specification lists it.
- **`local/lit-css`**, a processor (`eslint-local-rules/lit-css-processor.ts`), hands each `css` tagged template of `src/ui/**/*.ts` to that block as a virtual `N.css` file. The TypeScript file itself is still linted as it is. Templates are found with the TypeScript parser, so a `css` in a comment or another tag is never taken. A `${…}` alone on its line (a composed style module) becomes a comment, and one inside a value becomes `var(--interpolated)`, padded with the newlines the expression spanned, so every line keeps its number. Messages map back by the template's line, and on its first line by its column, so they point at the right place in the `.ts` file. Fixes and suggestions from a block are dropped; their ranges are the block's.
- **The JavaScript and TypeScript presets** name no files. With `.css` files now reaching the config, the final config scopes every block that has rules, a language or plugins and no `files` to code files. Ignores and linter options stay global.
- **Overflow is logical too.** ADR 0114 exempted `overflow-x`/`-y` because "Chromium has no logical overflow". That was wrong for Electron 45, which supports `overflow-inline` and `overflow-block` (checked with `CSS.supports`). `prefer-logical-properties` caught the nine uses. They are converted, and `local/css-logical-properties` now reports `overflow-x`/`-y` as well.
- **What stays local.** `local/css-design-tokens` and `local/css-logical-properties` still run. No general CSS linter knows beuve's tokens, and only the local rules see CSS in `html` style attributes and in strings. The one `@eslint/css` finding left in the code, `font: var(--beuve-font-body)` in `index.css`, is disabled on its line with the reason: the validator cannot expand a shorthand held in a token.

## Consequences

A CSS mistake in a component fails lint like a TypeScript one, at its line, in the editor and in CI's `lint:ci`, with no new check or tool. Adding a non-standard property means declaring it in `customSyntax`. The processor's placeholders are a heuristic. A `${…}` that stands for something other than a value or a whole module, such as part of a selector, would read as a value and could be reported wrongly; none does today, and such a template would need restructuring or a disable comment.
