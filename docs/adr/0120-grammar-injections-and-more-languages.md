# 0120. Grammar injections, more languages, and `shiki` as a direct dependency

- Status: Accepted; amends [0025](0025-diff-cards-themes-and-lazy-mounting.md) (grammars) and [0119](0119-syntax-by-weight-and-slant.md) (declarations)
- Date: 2026-11-06

## Context

ADR 0119 styles code by what a token is: definitions and declarations bold, types italic, keywords and punctuation muted. A theme can only style the scopes a grammar emits, and the grammars disagree:

- TypeScript marks a declaration (`meta.definition.variable`).
- Ruby marks a local's assignment target (`variable.ruby`).
- Go and shell mark assignment targets.
- Python leaves assignment targets unscoped.
- Rust scopes `let w` like any use of `w`.
- Perl scopes `my $x` like `$x`.
- awk leaves names unscoped.
- fish leaves `set` names, function names and numbers unscoped.

Perl and awk also leave most punctuation unscoped, and Perl its numbers. Reviewers also asked for Ruby, Perl, awk and fish, which ADR 0025's curated list left as plain text, and `@pierre/diffs` maps `.pl` to Prolog.

## Decision

- **Injection grammars fill the gaps.** `src/ui/grammar-injections.ts` holds one small TextMate injection grammar per language whose grammar lacks a scope beuve's theme needs: Python, Rust, Ruby, Perl, awk and fish. Each adds `variable.other.declaration.<lang>` to the names declarations introduce (Python's assignment, `for` and `as` targets; Rust's `let`, `const`, `static`, `for` and parameters; Ruby's `@ivar =`, `$global =` and `CONST =`; Perl's `my`, `our`, `local` and `state`; awk's assignment targets and `for (k in …)`; fish's `set`, `for`, function names and `--argument-names`). For Perl, awk and fish it adds the numbers and punctuation their grammars leave unscoped.
  - Each applies outside strings and comments, with an `L:` selector, so it wins a tie with the host grammar and scopes any keyword it takes over itself.
  - That priority would also let an injection take the token that ends one of its own begin/end rules, or a host rule's. So those rules are named `meta.declaration` and excluded from the selector. awk's injection leaves parentheses alone, because its parameter list is an unnamed host rule. A host rule can also start earlier than the token it is about: fish's command rule starts at a line's indentation, so fish's patterns do too, to tie with it rather than lose to it. The tests cover indented lines in each injected language for this reason.
  - The cost is a regular expression per pattern, kept to one line each. Multi-line constructs are partial: a Rust signature split across lines, or nested parentheses in a parameter's type, ends the parameter rule early. Closure parameters (`|i|`) are not marked, and neither are Python comprehension targets inside a call's arguments.
- **`loadDiffsLibrary` registers them.** For each injected language it registers a custom language whose loader returns Shiki's grammar for it (`shiki/langs/<lang>.mjs`) plus the injection, both lazy chunks. The library resolves languages on the main thread and passes the grammars to its highlighting workers, so the workers get the injections too. The `stylesOf` test fixture loads the library the same way, so the tests exercise this path, not a copy.
- **`shiki` becomes a direct dependency**, pinned to 4.5.0, the version `@pierre/diffs` already installs, deduplicated (no new package in the tree). Importing `shiki/langs/*` needs it declared (`no-non-package-json`). The other routes were worse. Merging injections in the build plugin would leave tests and Storybook on a different path from the app. Resolving every base grammar when the library loads would give up ADR 0025's lazy grammar chunks. A `@pierre/diffs` upgrade that moves to another Shiki major now needs this pin moved with it.
- **More languages.** `highlighted-languages.ts` adds Ruby, Perl, awk and fish. `.sh`, `.bash` and `.zsh` already reached the shell grammar, and CSS and HTML were already listed. `loadDiffsLibrary` maps `.pl` to Perl with `setCustomExtension`, since in a code review it is far more often Perl than Prolog. Chat code fences labelled `ruby` or `perl` get the matching extensions.

## Consequences

Ruby, Perl, awk and fish files are highlighted. Shiki's Ruby grammar embeds a dozen languages for heredocs, so the lazy chunks grow by about 1 MB, loaded only when a Ruby file is shown. The eager bundle grows by about 1 KiB. An extensionless script (`bin/deploy` with a `#!/usr/bin/env bash` line) is still plain text, because the library picks a grammar from the file name alone; detecting the shebang would need the file's first line, which a patch does not always include. Each injection is a set of regular expressions over a grammar beuve does not own, so a Shiki grammar update can shift what they meet; the per-language tests in `textmate-theme-from.test.ts` pin the result for each language.
