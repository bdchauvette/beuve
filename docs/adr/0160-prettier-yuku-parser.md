# 0160. Prettier formats JavaScript and TypeScript with the Yuku parser

- Status: Accepted
- Date: 2026-11-24

## Context

Prettier 3.10 ships `@prettier/plugin-yuku`, a Prettier-maintained plugin that parses JavaScript and TypeScript with Yuku, a native parser, in place of the built-in `typescript` and `babel` parsers. It is 0.0.3, MIT, published 2026-11-11, and its one dependency is `yuku` 0.28.0, which loads a per-platform binary from optional packages (`@yuku-toolchain/<os>-<cpu>`). Neither the plugin nor `yuku` has an install script, so `allowScripts` needs no entry. The binary covers Linux, macOS and Windows on x64 and arm64, which is every platform CI and the packaged app's build use.

Measured on this repository with `prettier --check "src/**/*.ts"`: 8.1 s with `yuku-ts`, 10.2 s with the `typescript` parser. Both parsers pass `prettier --check .` on every file in the repository with no formatting change, including the decorators and `accessor` fields the Lit components use.

## Decision

`.prettierrc.json` loads the plugin and sets `parser: "yuku"` for `*.{js,mjs,cjs,jsx}` and `parser: "yuku-ts"` for `*.{ts,mts,cts,tsx}`. Everything else (CSS, Markdown, JSON, YAML, HTML) keeps Prettier's own parsers. Prettier's options are unchanged.

The plugin is a development dependency only. Nothing ships in the app and nothing runs at build or run time.

## Consequences

- `format` and `format:ci` are about a fifth faster on TypeScript.
- The plugin is 0.0.x. If a Prettier release changes its AST contract, or a file formats differently under the two parsers, the fix is to delete the two `overrides` and the `plugins` entry, which returns formatting to the built-in parsers. A bump of Prettier or the plugin should be checked with `npm run format:ci`.
- ESLint, TypeScript and the type-aware rules are unaffected: they have their own parsers.
- A contributor on a platform without a Yuku binary cannot run the formatter. None of the six published platforms is missing from the supported set.
