# 0138. American English in strings and comments, enforced by a lint rule

- Status: Accepted
- Date: 2026-11-11

## Context

The UI mixed spellings: `neighbours` in the Files sidebar's tooltip and `analyse` in a flow error, beside `neighbor` and `analyze` elsewhere, and `colour` and `behaviour` through comments. A spelling checker for prose (Vale) was considered. It lints Markdown and code comments, but not string literals or Lit template text, which is where the text users read lives, and it needs a Go binary and a CI install step. The repository already enforces its conventions with local ESLint rules.

## Decision

Strings, template text and comments in `src/**/*.ts`, tests included, use American spellings. `local/american-spelling` reports a British form (`-our`, `-ise`/`-isation`, `-yse`, `centre`, `-ence` for `defence`, `offence` and `licence`, `grey`, doubled `l` before `-ed`/`-ing`, `whilst`, `amongst`) and names the American one. It does not read identifiers, so a name that only mentions a word is the author's call, and it ignores `cancelled`, which American English accepts and which is a status value on the wire.

The rule is a list of stems and endings in `eslint-local-rules/american-spelling.ts`; a missed word is added there with a test.

## Consequences

- A British spelling in a tooltip, an error message or a comment fails `npm run lint`.
- ADRs, `docs/` and CSS are not checked, and neither are identifiers. Markdown prose is the one place Vale would add coverage; revisit if the docs need it.
- The word list is finite, so a rare British word passes until someone adds it.
