# 0159. The WebAssembly diff backend, and `'wasm-unsafe-eval'` for the main window

- Status: Accepted; amends [0018](0018-pierre-diffs-and-trees-integration.md) and [0025](0025-diff-cards-themes-and-lazy-mounting.md)
- Date: 2026-11-24

## Context

`@pierre/diffs` 1.7 can compute its word and character highlights, and any diff it has to build itself (an edited card, ADR 0063), with `@pierre/patches` in place of jsdiff. `@pierre/patches` is a diff library written by hand in WebAssembly Text, 0.0.1, Apache-2.0, with no dependencies and no install script. It is a dependency of `@pierre/diffs` 1.7, so it arrives with the upgrade. Its module is inlined as base64 in the JavaScript, so nothing new loads by path and `electron-builder.yml` needs no entry.

Measured in Node 26 on the stream's own source (1,500 lines, one in three changed):

| Work                                          | jsdiff | `@pierre/patches` |
| --------------------------------------------- | ------ | ----------------- |
| A unified patch for the whole file            | 77 ms  | 2.3 ms            |
| `diffWordsWithSpace` on the 495 changed lines | 2.8 ms | 0.9 ms            |
| `diffChars` on the 495 changed lines          | 2.0 ms | 0.8 ms            |

Git, not the library, produces the patches the cards show, so the large gain applies only to the diffs an edit rebuilds. The word and character highlights, which run for every changed line a card renders, are about three times faster.

The renderer's CSP has `script-src 'self'` with no `'wasm-unsafe-eval'` (ADR 0018), and ADR 0025 kept it that way when it measured Oniguruma. Compiling any WebAssembly module on the page needs that keyword. Without it `@pierre/diffs` logs one error and falls back to jsdiff, so the setting alone gains nothing.

## Decision

- `FileDiff` takes `parseDiffOptions: { preferredDiffLib: '@pierre/patches' }`, and the highlighting worker pool takes `preferredDiffLib: '@pierre/patches'` (the pool uses its own value for highlights).
- `src/ui/index.html`, the window that holds diff cards, adds `'wasm-unsafe-eval'` to `script-src`. `sheet.html` and `settings.html` do not: sheets render files without diffing, and settings render no code.
- Highlighting stays on Shiki's JavaScript regex engine, and `shiki/wasm` stays stubbed (ADR 0025). The keyword is for `@pierre/patches` only.
- The library falls back to jsdiff when the module cannot compile, logging once, so a stricter policy later degrades to the old speed and does not break cards.

## Consequences

- The main window can now compile WebAssembly. The keyword does not allow `eval`, `new Function` or inline script, and the Trusted Types policy and `script-src 'self'` still decide what script runs. Any script that ran could now also build a wasm module, which adds little to what script can already do. This is the first widening of the script policy since ADR 0018.
- The highlighting worker loads from `file://` and has no policy of its own beyond the library's fallback; if a later change gives workers a CSP, it needs the same keyword.
- A diff the library cannot compute through the wasm module gives the same output as jsdiff (the library's tests cover both), so a card's content does not depend on which backend ran.
- `@pierre/patches` is 0.0.1. Bumps of `@pierre/diffs` should be checked against the hostile render check (`scripts/check-hostile-render.ts`).
