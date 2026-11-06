# 0120. More languages, styled from the grammars as Shiki ships them

- Status: Accepted (shebang detection amended 2026-11-06); amends [0025](0025-diff-cards-themes-and-lazy-mounting.md) (grammars) and [0119](0119-syntax-by-weight-and-slant.md) (declarations)
- Date: 2026-11-06

## Context

ADR 0119 styles code by what a token is, and a theme can only style the scopes a grammar emits. The grammars disagree on declarations:

- TypeScript marks a declaration (`meta.definition.variable`).
- Ruby marks a local's assignment target (`variable.ruby`).
- Go and shell mark assignment targets.
- Python leaves assignment targets unscoped.
- Rust scopes `let w` like any use of `w`.
- Perl scopes `my $x` like `$x`.
- awk leaves names unscoped.
- fish leaves `set` names, function names and numbers unscoped.

Perl and awk also leave most punctuation unscoped, and Perl its numbers. Reviewers also asked for Ruby, Perl, awk and fish, which ADR 0025's curated list left as plain text. `@pierre/diffs` maps `.pl` to Prolog.

## Decision

- **Style what the grammars mark, and nothing more.** The theme bolds the declarations a grammar marks (ADR 0119) and leaves the rest regular. beuve adds no scopes of its own.
- **Injection grammars were tried and dropped.** Small TextMate injections added the missing scopes for Python, Rust, Ruby, Perl, awk and fish. Each was registered as a custom language whose loader returned Shiki's grammar plus the injection, which made the highlighting workers use it too. They worked, but they cost more than the bold is worth:
  - beuve would have to import `shiki/langs/*` itself, which means declaring `shiki` as a direct dependency and moving its pin with every `@pierre/diffs` upgrade.
  - The `L:` priority that lets an injection beat its host grammar also let it take the tokens that end its own and the host's begin/end rules. In Perl, that swallowed everything after a `my (…)` line. In awk, it broke parameter lists. In fish, the host's command rule starting at a line's indentation won on every indented line.
  - The regular expressions run over grammars beuve does not own, so a Shiki update could shift what they meet.

  If a language's missing scopes become a real problem, the fix belongs upstream in its grammar.

- **More languages.** `highlighted-languages.ts` adds Ruby, Perl, awk and fish. `.sh`, `.bash` and `.zsh` already reached the shell grammar, and CSS and HTML were already listed. `loadDiffsLibrary` maps `.pl` to Perl with the library's `setCustomExtension`, since in a code review it is far more often Perl than Prolog. Chat code fences labelled `ruby` or `perl` get the matching extensions.

## Consequences

Ruby, Perl, awk and fish files are highlighted, with less detail in Perl, awk and fish than elsewhere: fish shows only keywords and comments, and Perl shows unscoped numbers and punctuation as plain text. Shiki's Ruby grammar embeds a dozen languages for heredocs, so the lazy chunks grow by about 1 MB, loaded only when a Ruby file is shown. An extensionless script (`bin/deploy` with a `#!/usr/bin/env bash` line) is highlighted by its interpreter (amendment below). The per-language tests in `textmate-theme-from.test.ts` pin what each shipped grammar gives, so a Shiki update that changes it shows up as a test failure.

## Amendment 2026-11-06: shebang detection

The library picks a grammar from the file name alone, so `bin/deploy` rendered as plain text. A patch has the `#!` line only when a hunk touches line 1, so the line comes from the blob:

- **Main** reads, for each review file whose name has no extension, the first line of its head blob (the base blob for a deleted file) in one `readBlobs` batch on the warm `cat-file` reader, capped at 256 KiB per blob. A `#!` line goes to the renderer as `DiffFileView.shebang` (`read-shebangs.ts`, called by `loadReview`). Binary, submodule and oversized blobs have none. A read that fails is logged and the review loads without them, since only highlighting depends on them. Commit-pair interdiffs do not carry it.
- **The renderer** maps the line to a grammar with `languageFromShebang`. It reads through `env` and its options and assignments (`#!/usr/bin/env -S python3 -u`) and drops version suffixes (`python3.12`, `perl5`). It covers the shells (sh, bash, zsh, dash, ksh), fish, Python, Ruby, Perl, Node and Bun (JavaScript), Deno, ts-node and tsx (TypeScript), and the awks. The file card applies it when the name gives no highlighted language. The definition sheet, which has the whole file, applies it to the file's first line.
